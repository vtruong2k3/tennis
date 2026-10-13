"""
trackers/tracknet_v3/background.py
──────────────────────────────────
Background estimation and temporal background subtraction for TrackNetV3.

Computes a representative median background image across video frames to
suppress background clutter (court markings, spectators, advertising boards)
and highlight moving tennis balls.
"""
from __future__ import annotations

import logging
from typing import Sequence

import cv2
import numpy as np
import torch

logger = logging.getLogger(__name__)


class BackgroundEstimator:
    """
    Estimates court background via temporal median filtering across sampled frames.
    """

    def __init__(self, target_width: int = 640, target_height: int = 360):
        self.target_width = target_width
        self.target_height = target_height
        self._median_bg: np.ndarray | None = None

    @property
    def has_background(self) -> bool:
        return self._median_bg is not None

    def compute_from_frames(
        self,
        frames: Sequence[np.ndarray],
        max_samples: int = 60,
    ) -> np.ndarray:
        """
        Estimate median background by sampling up to `max_samples` frames.
        """
        if not frames:
            raise ValueError("Cannot estimate background from an empty frame sequence.")

        total_frames = len(frames)
        sample_indices = np.linspace(
            0, total_frames - 1, num=min(total_frames, max_samples), dtype=int
        )

        sampled_resized = [
            cv2.resize(frames[idx], (self.target_width, self.target_height))
            for idx in sample_indices
        ]

        # Compute median across the temporal sample stack
        stack = np.stack(sampled_resized, axis=0)
        self._median_bg = np.median(stack, axis=0).astype(np.uint8)
        logger.debug(
            f"BackgroundEstimator: computed median background from {len(sample_indices)} frames."
        )
        return self._median_bg

    def get_background(self, width: int | None = None, height: int | None = None) -> np.ndarray:
        """Return the estimated median background, resized if requested."""
        if self._median_bg is None:
            raise RuntimeError("Background has not been estimated yet. Call compute_from_frames first.")

        w = width or self.target_width
        h = height or self.target_height
        if w == self.target_width and h == self.target_height:
            return self._median_bg.copy()
        return cv2.resize(self._median_bg, (w, h))

    def prepare_background_tensor(
        self,
        target_width: int,
        target_height: int,
        device: torch.device,
    ) -> torch.Tensor:
        """
        Returns normalized background tensor of shape (1, 3, H, W).
        """
        bg = self.get_background(target_width, target_height)
        bg_rgb = cv2.cvtColor(bg, cv2.COLOR_BGR2RGB).astype(np.float32) / 255.0
        bg_tensor = torch.from_numpy(bg_rgb.transpose(2, 0, 1)).unsqueeze(0).to(device)
        return bg_tensor
