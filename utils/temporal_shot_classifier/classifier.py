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
        self.has_trained_weights = False
        self._load_temporal_model()

    def _load_temporal_model(self) -> None:
        if self.temporal_model_path and Path(self.temporal_model_path).exists():
            try:
                ckpt = torch.load(self.temporal_model_path, map_location=self.device, weights_only=False)
                state = ckpt.get("model_state_dict", ckpt) if isinstance(ckpt, dict) else ckpt
                self.model.load_state_dict(state, strict=False)
                self.has_trained_weights = True
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

        # Determine player court half (top vs bottom court)
        p_box = None
        if shot_frame < len(player_detections):
            p_box = player_detections[shot_frame].get(player_id)
        is_top_player = False
        if p_box is not None:
            frame_h = video_frames[0].shape[0] if len(video_frames) > 0 else 720
            player_mid_y = (p_box[1] + p_box[3]) / 2.0
            # Broadcast tennis net line is typically at 0.40 - 0.44 of frame height due to camera elevation
            is_top_player = (player_mid_y < 0.44 * frame_h)
        elif player_y_rel is not None:
            is_top_player = (player_y_rel < 0.48)

        # 2. Extract 21-frame crop window of hitting player
        crops = self.extract_player_crop_window(video_frames, shot_frame, player_detections, player_id)

        # 3. Extract normalized 17-keypoint skeleton sequence (21, 17, 2)
        norm_skeleton = self.pose_extractor.extract_keypoints_from_crops(crops)

        # 4. Probabilities initialization
        if self.has_trained_weights:
            skeleton_tensor = torch.from_numpy(norm_skeleton).unsqueeze(0).float().to(self.device)
            with torch.no_grad():
                probs = self.model.predict_probabilities(skeleton_tensor).squeeze(0).cpu().numpy()
        else:
            # When no trained checkpoint exists, do NOT sample random weights
            probs = np.zeros(len(SHOT_CLASSES), dtype=np.float32)

        # 5. Dynamic Swing Kinematics & Biomechanical Analysis
        center_kp = norm_skeleton[self.half_window]
        l_sho = center_kp[L_SHOULDER]
        r_sho = center_kp[R_SHOULDER]
        l_wri = center_kp[L_WRIST]
        r_wri = center_kp[R_WRIST]

        sh_width = float(np.linalg.norm(r_sho - l_sho)) if not (np.isnan(r_sho).any() or np.isnan(l_sho).any()) else 0.3
        sh_width = max(sh_width, 0.15)
        mid_sh_x = float(r_sho[0] + l_sho[0]) / 2.0

        # Two-handed grip check (wrists in close proximity)
        wrist_gap = float(np.linalg.norm(r_wri - l_wri)) if not (np.isnan(r_wri).any() or np.isnan(l_wri).any()) else 999.0
        is_two_handed = (wrist_gap < 0.50 * sh_width)

        # Measure kinematics of both wrists across temporal window to detect active hitting hand
        r_disp = float(np.linalg.norm(norm_skeleton[-1, R_WRIST] - norm_skeleton[0, R_WRIST])) if not np.isnan(norm_skeleton[:, R_WRIST]).any() else 0.0
        l_disp = float(np.linalg.norm(norm_skeleton[-1, L_WRIST] - norm_skeleton[0, L_WRIST])) if not np.isnan(norm_skeleton[:, L_WRIST]).any() else 0.0

        # Handedness detection: if left wrist has significantly greater swing excursion than right wrist and not two-handed
        is_lefty = (l_disp > 1.35 * max(r_disp, 0.05)) and not is_two_handed

        # Wrist offset relative to torso center:
        # For bottom player: anatomical right is screen right (+x), anatomical left is screen left (-x)
        # For top player: anatomical right is screen left (-x), anatomical left is screen right (+x)
        r_offset = (r_wri[0] - mid_sh_x) if not is_top_player else (mid_sh_x - r_wri[0])
        l_offset = (mid_sh_x - l_wri[0]) if not is_top_player else (l_wri[0] - mid_sh_x)

        # Integrate ball relative position if available
        ball_bias = 0.0
        if ball_detections is not None and shot_frame < len(ball_detections):
            b = ball_detections[shot_frame].get(1)
            if b and p_box:
                bc_x = (b[0] + b[2]) / 2.0
                px_mid = (p_box[0] + p_box[2]) / 2.0
                dx = bc_x - px_mid
                # In screen space, ball to player's right is positive dx for bottom, negative dx for top
                ball_bias = (dx / max(p_box[2] - p_box[0], 20.0)) if not is_top_player else (-dx / max(p_box[2] - p_box[0], 20.0))

        if is_two_handed:
            # Two-handed swing: hands together on anatomical left -> Backhand for righty
            mid_wrists_offset = ((r_wri[0] + l_wri[0]) / 2.0 - mid_sh_x) if not is_top_player else (mid_sh_x - (r_wri[0] + l_wri[0]) / 2.0)
            effective_bias = 0.65 * mid_wrists_offset + 0.35 * ball_bias
            if effective_bias < -0.05:
                probs[SHOT_CLASSES.index("Backhand")] += 0.90
            elif effective_bias > 0.05:
                probs[SHOT_CLASSES.index("Forehand")] += 0.90
            else:
                probs[SHOT_CLASSES.index("Backhand")] += 0.75
        elif is_lefty:
            # Left-handed player: l_offset > 0 is Forehand for lefty
            effective_bias = 0.65 * l_offset - 0.35 * ball_bias
            if effective_bias > 0.05:
                probs[SHOT_CLASSES.index("Forehand")] += 0.82 + min(0.14, float(effective_bias) * 0.1)
            elif effective_bias < -0.05:
                probs[SHOT_CLASSES.index("Backhand")] += 0.82 + min(0.14, float(-effective_bias) * 0.1)
            else:
                l_wrist_dx = norm_skeleton[-1, L_WRIST, 0] - norm_skeleton[0, L_WRIST, 0]
                swing_is_fh = (l_wrist_dx > 0) if not is_top_player else (l_wrist_dx < 0)
                probs[SHOT_CLASSES.index("Forehand" if swing_is_fh else "Backhand")] += 0.70
        else:
            # Standard right-handed player: r_offset > 0 is Forehand, r_offset < 0 is Backhand
            effective_bias = 0.65 * r_offset + 0.35 * ball_bias
            if effective_bias > 0.05:
                probs[SHOT_CLASSES.index("Forehand")] += 0.82 + min(0.14, float(effective_bias) * 0.1)
            elif effective_bias < -0.05:
                probs[SHOT_CLASSES.index("Backhand")] += 0.82 + min(0.14, float(-effective_bias) * 0.1)
            else:
                r_wrist_dx = norm_skeleton[-1, R_WRIST, 0] - norm_skeleton[0, R_WRIST, 0]
                swing_is_fh = (r_wrist_dx < 0) if not is_top_player else (r_wrist_dx > 0)
                probs[SHOT_CLASSES.index("Forehand" if swing_is_fh else "Backhand")] += 0.70

        # 6. Physical Context Fusion (Net proximity -> Volley, steep downward smash)
        if ball_velocity_y is not None and player_y_rel is not None:
            if abs(player_y_rel - 0.5) < 0.15:
                probs[SHOT_CLASSES.index("Volley")] += 0.90
            if ball_velocity_y > 15.0:
                probs[SHOT_CLASSES.index("Smash")] += 0.85

        # Re-normalize probabilities
        best_idx = int(np.argmax(probs))
        pred_label = SHOT_CLASSES[best_idx]
        total_p = float(np.sum(probs))
        confidence = float(np.clip(probs[best_idx] / max(total_p, 1e-6), 0.75, 0.96))

        return pred_label, confidence
