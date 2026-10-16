"""
utils/temporal_shot_classifier/pose_extractor.py
────────────────────────────────────────────────
On-demand YOLO-Pose keypoint extractor for tennis stroke analysis:
- Runs lightweight YOLO11n-Pose on cropped player bounding boxes
- Normalizes 17 body keypoints to be root-relative and scale-invariant
- Handles temporal occlusion with linear keypoint interpolation
"""
from __future__ import annotations

import logging
from pathlib import Path
from typing import Sequence

import cv2
import numpy as np
import torch

logger = logging.getLogger(__name__)


# COCO 17 Keypoints Index Mapping
NOSE = 0
L_EYE, R_EYE = 1, 2
L_EAR, R_EAR = 3, 4
L_SHOULDER, R_SHOULDER = 5, 6
L_ELBOW, R_ELBOW = 7, 8
L_WRIST, R_WRIST = 9, 10
L_HIP, R_HIP = 11, 12
L_KNEE, R_KNEE = 13, 14
L_ANKLE, R_ANKLE = 15, 16


class YoloPoseExtractor:
    """
    Extracts 17 body landmarks on cropped player image sequences.
    """
    def __init__(
        self,
        model_path: str = "yolo11n-pose.pt",
        device: torch.device | None = None,
        conf_threshold: float = 0.25,
    ):
        self.model_path = model_path
        self.conf_threshold = conf_threshold
        self.device = device or torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.model = None
        self._load_model()

    def _load_model(self) -> None:
        try:
            from ultralytics import YOLO
            # Ultralytics will load from local if exists, or auto-download yolo11n-pose.pt (~6.2 MB)
            self.model = YOLO(self.model_path)
            logger.info(f"Loaded YOLO-Pose model from '{self.model_path}' on {self.device}")
        except Exception as exc:
            logger.warning(f"Could not load YOLO-Pose model '{self.model_path}': {exc}")
            self.model = None

    def normalize_skeleton(self, keypoints: np.ndarray) -> np.ndarray:
        """
        Normalizes a sequence of keypoints (T, 17, 2):
        1. Translates origin to mid-hip point.
        2. Scales by torso length (mid-shoulder to mid-hip).
        """
        norm_kps = np.copy(keypoints)
        T, num_kps, _ = norm_kps.shape

        for t in range(T):
            pts = norm_kps[t]
            # Root: mid-hip
            l_hip = pts[L_HIP]
            r_hip = pts[R_HIP]
            mid_hip = (l_hip + r_hip) / 2.0 if (not np.isnan(l_hip).any() and not np.isnan(r_hip).any()) else pts[L_HIP]

            # Shoulders
            l_sh = pts[L_SHOULDER]
            r_sh = pts[R_SHOULDER]
            mid_sh = (l_sh + r_sh) / 2.0 if (not np.isnan(l_sh).any() and not np.isnan(r_sh).any()) else pts[L_SHOULDER]

            # Torso scale
            torso_len = np.linalg.norm(mid_sh - mid_hip)
            if np.isnan(torso_len) or torso_len < 1e-3:
                torso_len = 50.0  # Safe default scale in pixels

            # Shift & Scale
            norm_kps[t] = (pts - mid_hip) / torso_len

        # Fill any remaining NaNs via linear interpolation
        for k in range(num_kps):
            for dim in range(2):
                series = norm_kps[:, k, dim]
                if np.isnan(series).any():
                    valid = ~np.isnan(series)
                    if valid.any():
                        indices = np.arange(T)
                        norm_kps[:, k, dim] = np.interp(indices, indices[valid], series[valid])
                    else:
                        norm_kps[:, k, dim] = 0.0

        return norm_kps

    def normalize_keypoints(self, keypoints: np.ndarray) -> torch.Tensor:
        """
        Normalizes keypoints (T, 17, 2 or 3) and returns a PyTorch Tensor
        of shape (1, 34, T) ready for the temporal network.
        """
        if keypoints.ndim == 3 and keypoints.shape[-1] >= 2:
            pts2d = keypoints[..., :2]
        else:
            pts2d = keypoints
        norm = self.normalize_skeleton(pts2d)  # (T, 17, 2)
        T, num_k, c = norm.shape
        flat = norm.reshape(T, num_k * c).T  # (34, T)
        return torch.from_numpy(flat).unsqueeze(0).float()

    def extract_keypoints_from_crops(
        self,
        crops: Sequence[np.ndarray],
    ) -> np.ndarray:
        """
        Runs batch pose inference on a list of player image crops.
        Args:
            crops: List of T cropped BGR images (T frames).
        Returns:
            Normalized keypoints array of shape (T, 17, 2).
        """
        T = len(crops)
        if T == 0:
            return np.zeros((0, 17, 2), dtype=np.float32)

        if self.model is None:
            # Fallback zero skeleton if model is unavailable
            return np.zeros((T, 17, 2), dtype=np.float32)

        raw_keypoints = np.full((T, 17, 2), np.nan, dtype=np.float32)

        try:
            # Run batched inference on crops (resize to standard height 256 for speed)
            resized_crops = [
                cv2.resize(c, (192, 256), interpolation=cv2.INTER_LINEAR) if c.size > 0 else np.zeros((256, 192, 3), dtype=np.uint8)
                for c in crops
            ]
            results = self.model(resized_crops, verbose=False, device=str(self.device))

            for t, res in enumerate(results):
                if res.keypoints is not None and len(res.keypoints) > 0:
                    # Take the highest-confidence person detected in crop
                    kps_xy = res.keypoints.xy[0].cpu().numpy()  # (17, 2)
                    confs = res.keypoints.conf[0].cpu().numpy() if res.keypoints.conf is not None else np.ones(17)

                    for k in range(17):
                        if confs[k] >= self.conf_threshold:
                            raw_keypoints[t, k] = kps_xy[k]
        except Exception as exc:
            logger.warning(f"Error during YOLO-Pose extraction: {exc}")

        # Normalize skeleton
        return self.normalize_skeleton(raw_keypoints)
