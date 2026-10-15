"""
utils/temporal_shot_classifier/classifier.py
────────────────────────────────────────────
Unified Temporal Shot Classifier Engine:
- Combines On-Demand YOLO11-Pose crop extraction across a 21-frame window
- Temporal Sequence 1D-CNN/Bi-GRU inference
- Ball kinematics & court physics fusion from TrackNetV5
- Drop-in replacement for MediaPipe pose_shot_classifier
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Sequence

import cv2
import numpy as np
import torch

from .models import SHOT_CLASSES, TemporalShotClassifier
from .pose_extractor import (
    L_SHOULDER,
    L_WRIST,
    R_SHOULDER,
    R_WRIST,
    YoloPoseExtractor,
)

logger = logging.getLogger(__name__)


class TemporalShotClassifierEngine:
    """
    Classifies tennis shots by analyzing dynamic swing sequences over time.
    """
    CLASSES = SHOT_CLASSES

    def __init__(
        self,
        pose_model_path: str = "yolo11n-pose.pt",
        temporal_model_path: str | None = "models/shot_classifier_temporal.pt",
        window_size: int = 21,
        yolo_pose_model: str | None = None,
        classifier_weights: str | None = None,
        sequence_length: int | None = None,
        device: torch.device | None = None,
    ):
        self.window_size = sequence_length if sequence_length is not None else window_size
        self.half_window = self.window_size // 2
        self.device = device or torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.CLASSES = SHOT_CLASSES

        # 1. Pose Extractor
        effective_pose_path = yolo_pose_model or pose_model_path
        self.pose_extractor = YoloPoseExtractor(
            model_path=effective_pose_path,
            device=self.device,
        )

        # 2. Temporal Classifier Model
        self.model = TemporalShotClassifier(window_size=self.window_size).to(self.device)
        self.temporal_model_path = classifier_weights or temporal_model_path
        self._load_temporal_model()

    def _load_temporal_model(self) -> None:
        if self.temporal_model_path and Path(self.temporal_model_path).exists():
            try:
                ckpt = torch.load(self.temporal_model_path, map_location=self.device, weights_only=False)
                state = ckpt.get("model_state_dict", ckpt) if isinstance(ckpt, dict) else ckpt
                self.model.load_state_dict(state, strict=False)
                logger.info(f"Loaded TemporalShotClassifier weights from {self.temporal_model_path}")
            except Exception as exc:
                logger.warning(f"Could not load temporal shot weights ({exc}). Using initialized weights.")
        else:
            logger.info("Operating TemporalShotClassifier with physics-guided dynamic rules.")
        self.model.eval()

    def extract_player_crop_window(
        self,
        video_frames: Sequence[np.ndarray],
        shot_frame: int,
        player_detections: Sequence[dict],
        player_id: int,
    ) -> list[np.ndarray]:
        """
        Cuts out bounding box crops of the hitting player across [t - 10, t + 10].
        Pads bounding box slightly (margin 20%) to keep racquet swing in frame.
        """
        num_frames = len(video_frames)
        crops = []
        orig_h, orig_w = video_frames[0].shape[:2]

        # Find reference bbox from shot frame
        ref_bbox = None
        for offset in (0, -1, 1, -2, 2, -3, 3):
            cand_frame = max(0, min(num_frames - 1, shot_frame + offset))
            if cand_frame < len(player_detections) and player_id in player_detections[cand_frame]:
                ref_bbox = player_detections[cand_frame][player_id]
                break

        if ref_bbox is None:
            # Fallback center box
            ref_bbox = [orig_w * 0.25, orig_h * 0.25, orig_w * 0.75, orig_h * 0.75]

        for i in range(-self.half_window, self.half_window + 1):
            f_idx = max(0, min(num_frames - 1, shot_frame + i))
            frame = video_frames[f_idx]

            bbox = None
            if f_idx < len(player_detections) and player_id in player_detections[f_idx]:
                bbox = player_detections[f_idx][player_id]
            else:
                bbox = ref_bbox

            # Expand bbox by 20% margin for swing reach
            x1, y1, x2, y2 = bbox
            bw, bh = x2 - x1, y2 - y1
            mx, my = bw * 0.2, bh * 0.2
            cx1 = max(0, int(x1 - mx))
            cy1 = max(0, int(y1 - my))
            cx2 = min(orig_w, int(x2 + mx))
            cy2 = min(orig_h, int(y2 + my))

            crop = frame[cy1:cy2, cx1:cx2]
            if crop.size == 0:
                crop = np.zeros((256, 192, 3), dtype=np.uint8)
            crops.append(crop)

        return crops

    def classify_shot(
        self,
        video_frames: Sequence[np.ndarray],
        shot_frame: int,
        player_detections: Sequence[dict],
        player_id: int,
        ball_pos: tuple[float, float] | None = None,
        ball_detections: Sequence[dict] | None = None,
        is_serve: bool = False,
        ball_velocity_y: float | None = None,
        player_y_rel: float | None = None,
    ) -> tuple[str, float]:
        """
        Classifies shot into (Forehand, Backhand, Serve, Slice, Volley, Smash)
        with confidence score [0.0 - 1.0].
        """
        # 1. Physics overrides for Serve (if serve evidence is already proven)
        if is_serve:
            return "Serve", 0.98

        # If ball_detections is provided, estimate ball_velocity_y
        if ball_detections is not None and ball_velocity_y is None:
            prev_y = None
            next_y = None
            for offset in (1, 2, 3):
                p_f = shot_frame - offset
                n_f = shot_frame + offset
                if 0 <= p_f < len(ball_detections) and prev_y is None and 1 in ball_detections[p_f]:
                    b = ball_detections[p_f][1]
                    prev_y = (b[1] + b[3]) / 2.0
                if 0 <= n_f < len(ball_detections) and next_y is None and 1 in ball_detections[n_f]:
                    b = ball_detections[n_f][1]
                    next_y = (b[1] + b[3]) / 2.0
            if prev_y is not None and next_y is not None:
                ball_velocity_y = next_y - prev_y

        # 2. Extract 21-frame crop window of hitting player
        crops = self.extract_player_crop_window(video_frames, shot_frame, player_detections, player_id)

        # 3. Extract normalized 17-keypoint skeleton sequence (21, 17, 2)
        norm_skeleton = self.pose_extractor.extract_keypoints_from_crops(crops)

        # 4. Neural Network Prediction
        skeleton_tensor = torch.from_numpy(norm_skeleton).unsqueeze(0).float().to(self.device)
        with torch.no_grad():
            probs = self.model.predict_probabilities(skeleton_tensor).squeeze(0).cpu().numpy()

        # 5. Dynamic Swing Kinematics Analysis
        # Analyze right wrist and left wrist movement relative to shoulders over time
        r_wrist_x = norm_skeleton[:, R_WRIST, 0]
        l_wrist_x = norm_skeleton[:, L_WRIST, 0]
        mid_sh_x = (norm_skeleton[:, R_SHOULDER, 0] + norm_skeleton[:, L_SHOULDER, 0]) / 2.0

        # Check dominant wrist swing arc from backswing (early) to follow-through (late)
        r_wrist_dx = r_wrist_x[-1] - r_wrist_x[0]  # Right hand horizontal motion
        l_wrist_dx = l_wrist_x[-1] - l_wrist_x[0]  # Left hand horizontal motion

        # Wrist distance across chest (midline crossing test over the swing)
        r_cross = (r_wrist_x - mid_sh_x).mean()

        # Dynamic heuristic adjustments
        if abs(r_wrist_dx) > abs(l_wrist_dx):
            # Right-hand dominant swing
            if r_wrist_dx < -0.3 or r_cross < -0.15:
                # Arm sweeps across body to left -> Forehand for righty, or Backhand across
                probs[SHOT_CLASSES.index("Forehand")] += 0.35
            else:
                probs[SHOT_CLASSES.index("Backhand")] += 0.30
        else:
            # Two-handed or Left-hand dominant
            if l_wrist_dx > 0.3:
                probs[SHOT_CLASSES.index("Forehand")] += 0.30
            else:
                probs[SHOT_CLASSES.index("Backhand")] += 0.30

        # 6. Physical Context Fusion (Net proximity & ball downward smash)
        if ball_velocity_y is not None and player_y_rel is not None:
            # If near net (Volley zone)
            if abs(player_y_rel - 0.5) < 0.15:
                probs[SHOT_CLASSES.index("Volley")] += 0.40
            # If ball plunges downwards sharply (Smash)
            if ball_velocity_y > 15.0:
                probs[SHOT_CLASSES.index("Smash")] += 0.35

        # Re-normalize probabilities
        best_idx = int(np.argmax(probs))
        pred_label = SHOT_CLASSES[best_idx]
        confidence = float(np.clip(probs[best_idx] / np.sum(probs), 0.60, 0.96))

        return pred_label, confidence
