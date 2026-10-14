"""
trackers/tracknet_v3/tracker.py
───────────────────────────────
TrackNetV3BallTracker: State-of-the-art tennis ball tracking engine.

Combines:
1. Spatio-temporal ball detection (TrackNetV3 / TrackNetV2)
2. Background median subtraction / concatenation
3. Largest Connected Component (LCC) centroid extraction
4. InpaintNet trajectory rectification for occluded ball frames
5. Batched GPU inference for maximum speed
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

from .background import BackgroundEstimator
from .inpaint import TrajectoryRectifier, generate_inpaint_mask
from .models import BallTrackerNet, InpaintNetModel, TrackNetV3Model

logger = logging.getLogger(__name__)


class TrackNetV3BallTracker:
    """
    Unified Ball Tracker integrating TrackNetV3 perception and InpaintNet rectification.
    Full drop-in replacement for BallTracker and TrackNetBallTracker.
    """

    INPUT_HEIGHT = 360
    INPUT_WIDTH  = 640

    def __init__(
        self,
        model_path: str | None = None,
        inpaint_model_path: str | None = None,
        bg_mode: str = "concat",  # 'concat', 'subtract', or 'none'
        batch_size: int = 16,
        conf_threshold: float = 0.5,
        enable_rectification: bool = True,
        device: torch.device | None = None,
    ):
        self.model_path = model_path
        self.inpaint_model_path = inpaint_model_path
        self.bg_mode = bg_mode
        self.batch_size = batch_size
        self.conf_threshold = conf_threshold
        self.enable_rectification = enable_rectification

        self.device = device or torch.device("cuda" if torch.cuda.is_available() else "cpu")
        logger.info(f"TrackNetV3BallTracker initialized on device={self.device}")

        self.model: nn.Module | None = None
        self.inpaint_model: InpaintNetModel | None = None
        self.background_estimator = BackgroundEstimator(self.INPUT_WIDTH, self.INPUT_HEIGHT)

        self._load_models()
        self.rectifier = TrajectoryRectifier(
            inpaint_model=self.inpaint_model,
            device=self.device,
        )

    def _load_models(self) -> None:
        """Loads ball detection and inpaint model checkpoints if available."""
        # 1. Detection Model
        candidate_path = self.model_path
        if (not candidate_path or not Path(candidate_path).exists()) and Path("models/tracknet.pt").exists():
            candidate_path = "models/tracknet.pt"
            logger.info("Using models/tracknet.pt as ball detection model.")

        if candidate_path and Path(candidate_path).exists():
            try:
                ckpt = torch.load(candidate_path, map_location=self.device)
                state = ckpt
                if isinstance(ckpt, dict):
                    for k in ("model_state_dict", "state_dict", "model"):
                        if k in ckpt:
                            state = ckpt[k]
                            break

                # Determine if TrackNetV3 (U-Net) or TrackNetV2 (VGG-style)
                first_key = next(iter(state.keys())) if isinstance(state, dict) else ""
                if "down_block" in first_key:
                    in_channels = 12 if self.bg_mode == "concat" else 9
                    self.model = TrackNetV3Model(in_dim=in_channels, out_dim=3).to(self.device)
                    self.model.load_state_dict(state, strict=False)
                    logger.info("Loaded TrackNetV3 (U-Net architecture) checkpoint.")
                else:
                    self.model = BallTrackerNet().to(self.device)
                    self.model.load_state_dict(state, strict=False)
                    logger.info("Loaded BallTrackerNet (TrackNet v2 architecture) checkpoint.")

                self.model.eval()
            except Exception as exc:
                logger.error(f"Failed to load ball detection model from {candidate_path}: {exc}")
                self.model = None
        else:
            logger.warning(f"Detection model checkpoint not found at {self.model_path}.")

        # 2. InpaintNet Model
        if self.inpaint_model_path and Path(self.inpaint_model_path).exists():
            try:
                ckpt = torch.load(self.inpaint_model_path, map_location=self.device)
                state = ckpt.get("model", ckpt) if isinstance(ckpt, dict) else ckpt
                self.inpaint_model = InpaintNetModel().to(self.device)
                self.inpaint_model.load_state_dict(state, strict=False)
                self.inpaint_model.eval()
                logger.info("Loaded InpaintNet checkpoint for trajectory rectification.")
            except Exception as exc:
                logger.warning(f"Failed to load InpaintNet model: {exc}")
                self.inpaint_model = None

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
        mask = (intensity > 0.5).astype(np.uint8) if intensity.dtype == np.float32 else (intensity != 0).astype(np.uint8)

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
        Detect ball in every frame with batching and temporal rectification.
        Returns List[Dict] with format: {1: [x1, y1, x2, y2]} or {}.
        """
        if not frames:
            return []

        orig_h, orig_w = frames[0].shape[:2]
        num_frames = len(frames)

        if self.model is None:
            logger.warning("No detection model loaded - returning empty detections.")
            return [{} for _ in range(num_frames)]

        # 1. Estimate background across the clip
        logger.info(f"Estimating background for {num_frames} frames...")
        self.background_estimator.compute_from_frames(frames)
        bg_tensor = self.background_estimator.prepare_background_tensor(
            self.INPUT_WIDTH, self.INPUT_HEIGHT, self.device
        )

        # Free lingering GPU memory from previous stages (e.g. YOLO11x)
        if torch.cuda.is_available():
            torch.cuda.empty_cache()

        # BallTrackerNet (TrackNet v2) outputs 256 channels at 360x640, so batch_size 16
        # causes high VRAM spikes. Cap batch size to 2 for BallTrackerNet to prevent CUDA OOM.
        effective_batch_size = self.batch_size
        if not isinstance(self.model, TrackNetV3Model):
            effective_batch_size = min(self.batch_size, 2)

        # 2. Batch preprocessing and inference
        logger.info(f"Running TrackNetV3 batched inference (batch_size={effective_batch_size})...")
        raw_detections: list[list[float] | None] = []

        # Memory-efficient sliding frame preprocessor (LRU cache keeps max 8 frames in RAM)
        from functools import lru_cache

        @lru_cache(maxsize=8)
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
                    prev_f = get_resized_chw(idx - 1)
                    curr_f = get_resized_chw(idx)
                    next_f = get_resized_chw(idx + 1)

                    stacked = np.concatenate([prev_f, curr_f, next_f], axis=0)
                    batch_tensors.append(stacked)

                b_tensor = torch.from_numpy(np.stack(batch_tensors, axis=0)).to(self.device)

                if self.bg_mode == "concat" and isinstance(self.model, TrackNetV3Model) and self.model.in_dim == 12:
                    bg_expanded = bg_tensor.expand(b_tensor.size(0), -1, -1, -1)
                    b_tensor = torch.cat([bg_expanded, b_tensor], dim=1)

                out = self.model(b_tensor)

                if isinstance(self.model, TrackNetV3Model):
                    # Output is (B, 3, H, W); middle channel corresponds to current frame
                    heatmaps = out[:, 1, :, :].cpu().numpy()
                    for b_idx in range(heatmaps.shape[0]):
                        bbox = self._output_to_bbox(heatmaps[b_idx], orig_h, orig_w)
                        raw_detections.append(bbox)
                else:
                    # TrackNet v2 argmax output (B, 256, H*W)
                    argmax_out = out.argmax(dim=1).cpu().numpy()
                    for b_idx in range(argmax_out.shape[0]):
                        bbox = self._output_to_bbox(argmax_out[b_idx], orig_h, orig_w)
                        raw_detections.append(bbox)

        # 3. Extract coordinates and rectify occlusion gaps
        coords: list[tuple[float, float] | None] = [
            ((b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0) if b is not None else None
            for b in raw_detections
        ]

        if self.enable_rectification:
            logger.info("Applying InpaintNet trajectory rectification to occluded gaps...")
            rectified_coords = self.rectifier.rectify_coordinates(coords, orig_w, orig_h)
        else:
            rectified_coords = coords

        # 4. Format into Tennis-Vision bounding box dictionary format
        final_detections: list[dict] = []
        half = 12
        for pt in rectified_coords:
            if pt is not None:
                cx, cy = pt
                final_detections.append({1: [cx - half, cy - half, cx + half, cy + half]})
            else:
                final_detections.append({})

        detected_count = sum(1 for d in final_detections if d.get(1))
        logger.info(
            f"TrackNetV3: {detected_count}/{num_frames} frames active "
            f"({100 * detected_count / max(1, num_frames):.1f}%)"
        )
        return final_detections

    def detect_frames_with_tracking(
        self,
        frames: Sequence[np.ndarray],
        read_from_stub: bool = False,
        stub_path: str | None = None,
    ) -> list[dict]:
        """TrackNetV3 uses intrinsic temporal context and InpaintNet rectification."""
        return self.detect_frames(frames, read_from_stub, stub_path)

    def interpolate_ball_positions(
        self,
        detections: list[dict],
        smooth_window: int = 3,
    ) -> list[dict]:
        """
        Interpolates missing gaps and smooths trajectories using rolling median.
        """
        rows = [
            {"frame": i, "x": (d[1][0] + d[1][2]) / 2.0, "y": (d[1][1] + d[1][3]) / 2.0}
            if d.get(1) else {"frame": i, "x": np.nan, "y": np.nan}
            for i, d in enumerate(detections)
        ]
        df = pd.DataFrame(rows).set_index("frame")
        df[["x", "y"]] = df[["x", "y"]].interpolate(method="linear").bfill().ffill()

        if smooth_window > 1:
            df["x"] = df["x"].rolling(smooth_window, center=True, min_periods=1).median()
            df["y"] = df["y"].rolling(smooth_window, center=True, min_periods=1).median()

        half = 12
        return [
            {1: [cx - half, cy - half, cx + half, cy + half]}
            for cx, cy in ((float(r["x"]), float(r["y"])) for _, r in df.iterrows())
        ]

    def get_ball_shot_frames(
        self,
        detections: list[dict],
        min_spacing: int = 15,
        min_delta_y: float = 6.0,
    ) -> list[int]:
        """Vertical reversal detection matching BallTracker interface."""
        y = np.array([
            (d[1][1] + d[1][3]) / 2.0 if d.get(1) else np.nan
            for d in detections
        ])
        n = len(y)
        window = max(3, min_spacing // 3)

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

            if delta_before * delta_after < 0 and abs(delta_before) >= min_delta_y:
                candidates.append(i)

        shot_frames: list[int] = []
        for frame in candidates:
            if not shot_frames or frame - shot_frames[-1] >= min_spacing:
                shot_frames.append(frame)

        return shot_frames

    def draw_bboxes(
        self,
        frames: list[np.ndarray],
        detections: list[dict],
        color: tuple[int, int, int] = (0, 255, 255),
        thickness: int = 2,
    ) -> list[np.ndarray]:
        for frame, det in zip(frames, detections):
            if det.get(1):
                x1, y1, x2, y2 = [int(v) for v in det[1]]
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, thickness)
        return frames

    def filter_by_confidence(self, detections: list[dict], threshold: float) -> list[dict]:
        return detections
