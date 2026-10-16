"""
trackers/tracknet_v5/tracker.py
───────────────────────────────
TrackNetV5BallTracker: State-of-the-art tennis ball tracking engine for Tennis-Vision.

Combines:
1. TrackNetV5 perception: Motion Direction Decoupling (MDD) + R-STR Transformer Refinement
2. Tennis-Vision Largest Connected Component (LCC) centroid extraction
3. Sliding 3-frame temporal context with GPU batched inference
4. Graceful fallback to TrackNetV3 / TrackNet v2 when V5 weights are pending
5. Full drop-in API compatibility with BallTracker and TrackNetV3BallTracker
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Sequence

import cv2
import numpy as np
import pandas as pd
import torch
import torch.nn as nn

from .models import TrackNetV5

logger = logging.getLogger(__name__)


class TrackNetV5BallTracker:
    """
    Unified TrackNetV5 ball tracker.
    Full drop-in replacement for BallTracker and TrackNetV3BallTracker.
    """

    INPUT_HEIGHT = 288   # SOTA resolution from TrackNetV5 paper
    INPUT_WIDTH  = 512

    def __init__(
        self,
        model_path: str | None = "models/tracknet_v5.pt",
        batch_size: int = 16,
        conf_threshold: float = 0.5,
        fallback_model_path: str | None = "models/tracknet.pt",
        device: torch.device | None = None,
    ):
        self.model_path = model_path
        self.fallback_model_path = fallback_model_path
        self.batch_size = batch_size
        self.conf_threshold = conf_threshold
        self.device = device or torch.device("cuda" if torch.cuda.is_available() else "cpu")

        logger.info(f"TrackNetV5BallTracker initialized on device={self.device}")

        self.model: nn.Module | None = None
        self.fallback_tracker = None
        self._is_using_fallback = False

        self._load_model()

    def _load_model(self) -> None:
        """Loads TrackNetV5 weights or configures graceful fallback."""
        v5_path = Path(self.model_path) if self.model_path else None

        if v5_path and v5_path.exists():
            try:
                self.model = TrackNetV5().to(self.device)
                ckpt = torch.load(str(v5_path), map_location=self.device, weights_only=False)
                state = ckpt
                if isinstance(ckpt, dict):
                    for k in ("model_state_dict", "state_dict", "model"):
                        if k in ckpt:
                            state = ckpt[k]
                            break
                self.model.load_state_dict(state, strict=False)
                self.model.eval()
                self._is_using_fallback = False
                logger.info(f"✓ Loaded TrackNetV5 (MDD + R-STR) weights from {v5_path}")
                return
            except Exception as exc:
                logger.error(f"Failed to load TrackNetV5 weights from {v5_path}: {exc}")

        # Checkpoint not found: check fallback candidates in order of priority
        fallback_candidates: list[Path] = []
        if self.fallback_model_path:
            fallback_candidates.append(Path(self.fallback_model_path))
        fallback_candidates.extend([
            Path("models/tracknet.pt"),
            Path("models/tracknet_v3.pt"),
            Path("models/tracknet_v5.pt"),
        ])

        for fb_path in fallback_candidates:
            if fb_path.exists():
                try:
                    from trackers.tracknet_v3 import TrackNetV3BallTracker
                    logger.warning(
                        f"TrackNetV5 weights not found at '{v5_path}'. "
                        f"Falling back to TrackNetV3/V2 ({fb_path}) to maintain uninterrupted pipeline operation."
                    )
                    self.fallback_tracker = TrackNetV3BallTracker(
                        model_path=str(fb_path),
                        batch_size=self.batch_size,
                        conf_threshold=self.conf_threshold,
                        device=self.device,
                    )
                    self._is_using_fallback = True
                    return
                except Exception as fb_exc:
                    logger.error(f"Failed to initialize fallback tracker at {fb_path}: {fb_exc}")

        # If no weights exist anywhere, log error and do not run unweighted random inference
        logger.error(
            f"No pre-trained weights found for TrackNetV5 at '{v5_path}' or any fallback paths. "
            "TrackNet ball detection will return empty detections."
        )
        self.model = None
        self._is_using_fallback = False

    def _output_to_bbox(
        self,
        model_out: np.ndarray,
        orig_h: int,
        orig_w: int,
    ) -> list[float] | None:
        """
        Centroid of LARGEST connected heatmap response (Tennis-Vision LCC algorithm).
        """
        intensity = model_out.reshape((self.INPUT_HEIGHT, self.INPUT_WIDTH))
        mask = (intensity > self.conf_threshold).astype(np.uint8) if intensity.dtype == np.float32 else (intensity != 0).astype(np.uint8)

        if int(mask.sum()) < 5:
            return None

        n_labels, _, stats, centroids = cv2.connectedComponentsWithStats(mask, 8)
        if n_labels <= 1:
            return None

        # Label 0 is background; column 4 is area
        largest = 1 + int(np.argmax(stats[1:, 4]))
        if int(stats[largest, 4]) < 5:
            return None

        cx_in, cy_in = centroids[largest]
        cx = int(cx_in * orig_w / self.INPUT_WIDTH)
        cy = int(cy_in * orig_h / self.INPUT_HEIGHT)
        half = 12
        return [cx - half, cy - half, cx + half, cy + half]

    def detect_frames(
        self,
        frames: Sequence[np.ndarray],
        read_from_stub: bool = False,
        stub_path: str | None = None,
    ) -> list[dict]:
        """
        Detect ball across all video frames using TrackNetV5 or active fallback.
        Returns List[Dict] with format: {1: [x1, y1, x2, y2]} or {}.
        """
        if not frames:
            return []

        # If fallback is active, delegate directly
        if self._is_using_fallback and self.fallback_tracker is not None:
            return self.fallback_tracker.detect_frames(
                frames,
                read_from_stub=read_from_stub,
                stub_path=stub_path,
            )

        orig_h, orig_w = frames[0].shape[:2]
        num_frames = len(frames)

        if self.model is None:
            logger.warning("No detection model loaded - returning empty detections.")
            return [{} for _ in range(num_frames)]

        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        effective_batch_size = max(1, self.batch_size)
        logger.info(f"Running TrackNetV5 batched inference (batch_size={effective_batch_size})...")
        raw_detections: list[list[float] | None] = []

        from functools import lru_cache

        @lru_cache(maxsize=16)
        def get_resized_chw(idx: int) -> np.ndarray:
            clamped = max(0, min(num_frames - 1, idx))
            small = cv2.resize(frames[clamped], (self.INPUT_WIDTH, self.INPUT_HEIGHT), interpolation=cv2.INTER_LINEAR)
            small = cv2.cvtColor(small, cv2.COLOR_BGR2RGB)
            return (small.astype(np.float32) / 255.0).transpose(2, 0, 1)

        with torch.no_grad():
            for i in range(0, num_frames, effective_batch_size):
                batch_end = min(num_frames, i + effective_batch_size)
                batch_tensors = []

                for idx in range(i, batch_end):
                    f_prev = get_resized_chw(idx - 1)
                    f_curr = get_resized_chw(idx)
                    f_next = get_resized_chw(idx + 1)
                    # Stack triplet into (3, 3, H, W)
                    triplet = np.stack([f_prev, f_curr, f_next], axis=0)
                    batch_tensors.append(triplet)

                b_tensor = torch.from_numpy(np.stack(batch_tensors, axis=0)).to(self.device)
                heatmaps = self.model(b_tensor)  # (B, 3, H, W)

                # Channel index 1 corresponds to current frame (t)
                curr_heatmaps = heatmaps[:, 1, :, :].cpu().numpy()
                for b_idx in range(curr_heatmaps.shape[0]):
                    bbox = self._output_to_bbox(curr_heatmaps[b_idx], orig_h, orig_w)
                    raw_detections.append(bbox)

        final_detections: list[dict] = []
        for bbox in raw_detections:
            if bbox is not None:
                final_detections.append({1: bbox})
            else:
                final_detections.append({})

        detected_count = sum(1 for d in final_detections if d.get(1))
        logger.info(
            f"TrackNetV5: {detected_count}/{num_frames} frames active "
            f"({100.0 * detected_count / max(1, num_frames):.1f}%)"
        )
        return final_detections

    def interpolate_ball_positions(self, ball_positions: list[dict]) -> list[dict]:
        """Interpolates missing ball positions across brief gaps."""
        if self._is_using_fallback and self.fallback_tracker is not None:
            return self.fallback_tracker.interpolate_ball_positions(ball_positions)

        ball_boxes = [b.get(1, []) for b in ball_positions]
        df = pd.DataFrame(ball_boxes, columns=["x1", "y1", "x2", "y2"])
        df = df.interpolate(method="linear").bfill().ffill()
        return [{1: list(row)} if not any(np.isnan(row)) else {} for row in df.to_numpy()]

    def get_ball_shot_frames(
        self,
        detections: list[dict],
        min_spacing: int = 15,
        min_delta_y: float = 6.0,
        fps: float = 30.0,
    ) -> list[int]:
        """Vertical reversal detection matching BallTracker interface with FPS invariance."""
        eff_fps = max(1.0, float(fps))
        eff_min_spacing = max(6, int(round(min_spacing * (eff_fps / 30.0))))
        eff_min_delta_y = min_delta_y * (30.0 / eff_fps)

        if self._is_using_fallback and self.fallback_tracker is not None and hasattr(self.fallback_tracker, "get_ball_shot_frames"):
            try:
                return self.fallback_tracker.get_ball_shot_frames(
                    detections, min_spacing=eff_min_spacing, min_delta_y=eff_min_delta_y, fps=eff_fps
                )
            except TypeError:
                return self.fallback_tracker.get_ball_shot_frames(
                    detections, min_spacing=eff_min_spacing, min_delta_y=eff_min_delta_y
                )

        y = np.array([
            (d[1][1] + d[1][3]) / 2.0 if d.get(1) else np.nan
            for d in detections
        ])
        n = len(y)
        window = max(2, eff_min_spacing // 3)

        candidates: list[int] = []
        for i in range(window, n - window):
            y_prev = y[i - window : i]
            y_next = y[i + 1 : i + window + 1]

            prev_valid = y_prev[~np.isnan(y_prev)]
            next_valid = y_next[~np.isnan(y_next)]
            if len(prev_valid) == 0 or len(next_valid) == 0:
                continue

            avg_prev = float(prev_valid.mean())
            avg_next = float(next_valid.mean())
            curr = float(y[i]) if not np.isnan(y[i]) else (avg_prev + avg_next) / 2.0

            delta_before = curr - avg_prev
            delta_after = avg_next - curr

            if delta_before * delta_after < 0 and abs(delta_before) >= eff_min_delta_y:
                candidates.append(i)

        shot_frames: list[int] = []
        for frame in candidates:
            if not shot_frames or frame - shot_frames[-1] >= eff_min_spacing:
                shot_frames.append(frame)

        return shot_frames

    def filter_by_confidence(
        self,
        ball_detections: list[dict],
        confidence_threshold: float = 0.6,
    ) -> list[dict]:
        """API compatibility with BallTracker."""
        return ball_detections

    def draw_bboxes(
        self,
        video_frames: Sequence[np.ndarray],
        ball_detections: list[dict],
        color: tuple[int, int, int] = (0, 255, 255),
        thickness: int = 2,
    ) -> list[np.ndarray]:
        """Draws tracked ball location on frames."""
        output_frames = []
        for i, frame in enumerate(video_frames):
            frame_copy = frame.copy()
            if i < len(ball_detections) and 1 in ball_detections[i]:
                bbox = ball_detections[i][1]
                x1, y1, x2, y2 = [int(v) for v in bbox]
                cx, cy = (x1 + x2) // 2, (y1 + y2) // 2
                cv2.circle(frame_copy, (cx, cy), 6, color, -1)
                cv2.rectangle(frame_copy, (x1, y1), (x2, y2), color, thickness)
            output_frames.append(frame_copy)
        return output_frames
