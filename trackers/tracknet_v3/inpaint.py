"""
trackers/tracknet_v3/inpaint.py
───────────────────────────────
Trajectory rectification and occlusion gap repair using InpaintNet.

Ported from TrackNetV3 (ACM MM 2023) with enhancements:
1. Detects occlusion gaps where the ball temporarily disappears (e.g., passing behind
   a player, racket, or net post).
2. Uses InpaintNet (1D temporal ConvNet) to predict realistic trajectory coordinates
   across the gap.
3. Provides a physics-guided ballistic polynomial fallback when weights are absent.
"""
from __future__ import annotations

import logging
from typing import Sequence

import numpy as np
import torch
import torch.nn as nn

logger = logging.getLogger(__name__)


def generate_inpaint_mask(
    coords: Sequence[tuple[float, float] | None],
    min_gap: int = 1,
    max_gap: int = 15,
    min_context: int = 2,
) -> np.ndarray:
    """
    Generate binary inpaint mask (1 = occluded/to inpaint, 0 = observed).

    Args:
        coords: Sequence of (x, y) coordinates or None for missed detections.
        min_gap: Minimum missing frames to trigger rectification.
        max_gap: Maximum missing frames; gaps longer than this are considered
                 a real out-of-play event, not a temporary occlusion.
        min_context: Minimum observed frames required before/after gap.

    Returns:
        np.ndarray of shape (N,) with dtype bool (True for inpaint candidates).
    """
    n = len(coords)
    mask = np.zeros(n, dtype=bool)
    is_valid = np.array([pt is not None for pt in coords], dtype=bool)

    i = 0
    while i < n:
        if not is_valid[i]:
            # Gap starts at i
            j = i
            while j < n and not is_valid[j]:
                j += 1
            gap_len = j - i

            # Verify there is sufficient observed context on both sides
            has_left_context = (i >= min_context) and np.all(is_valid[i - min_context : i])
            has_right_context = (j + min_context <= n) and np.all(is_valid[j : j + min_context])

            if (min_gap <= gap_len <= max_gap) and has_left_context and has_right_context:
                mask[i:j] = True

            i = j
        else:
            i += 1

    return mask


class TrajectoryRectifier:
    """
    Rectifies ball trajectory gaps using InpaintNet or physics-guided polynomial fitting.
    """

    def __init__(
        self,
        inpaint_model: nn.Module | None = None,
        device: torch.device | None = None,
        seq_len: int = 16,
    ):
        self.inpaint_model = inpaint_model
        self.device = device or torch.device("cuda" if torch.cuda.is_available() else "cpu")
        self.seq_len = seq_len

        if self.inpaint_model is not None:
            self.inpaint_model.to(self.device).eval()

    def rectify_coordinates(
        self,
        coords: list[tuple[float, float] | None],
        frame_width: int,
        frame_height: int,
        mask: np.ndarray | None = None,
    ) -> list[tuple[float, float] | None]:
        """
        Rectify missed coordinates.

        Returns list of (x, y) coordinates with occluded frames filled in.
        """
        n = len(coords)
        if n == 0:
            return []

        if mask is None:
            mask = generate_inpaint_mask(coords)

        if not np.any(mask):
            return list(coords)

        # 1. Try neural inpainting via InpaintNet if model is loaded
        if self.inpaint_model is not None:
            try:
                rectified = self._neural_inpaint(coords, mask, frame_width, frame_height)
                return rectified
            except Exception as exc:
                logger.warning(f"InpaintNet inference failed ({exc}), falling back to physics fit.")

        # 2. Physics-guided ballistic polynomial fallback
        return self._ballistic_inpaint(coords, mask)

    def _neural_inpaint(
        self,
        coords: list[tuple[float, float] | None],
        mask: np.ndarray,
        frame_width: int,
        frame_height: int,
    ) -> list[tuple[float, float] | None]:
        """Runs InpaintNet in sliding windows of length self.seq_len."""
        n = len(coords)
        out_coords = list(coords)

        # Normalize existing coordinates to [0, 1]
        norm_xy = np.zeros((n, 2), dtype=np.float32)
        for idx, pt in enumerate(coords):
            if pt is not None:
                norm_xy[idx, 0] = pt[0] / max(1, frame_width)
                norm_xy[idx, 1] = pt[1] / max(1, frame_height)

        step = self.seq_len // 2
        for start in range(0, n, step):
            end = min(n, start + self.seq_len)
            sub_len = end - start
            if sub_len < 4:
                continue

            # Prepare padded window
            pad_len = self.seq_len - sub_len
            x_window = np.zeros((1, self.seq_len, 2), dtype=np.float32)
            m_window = np.zeros((1, self.seq_len, 1), dtype=np.float32)

            x_window[0, :sub_len] = norm_xy[start:end]
            m_window[0, :sub_len, 0] = mask[start:end].astype(np.float32)

            t_x = torch.from_numpy(x_window).to(self.device)
            t_m = torch.from_numpy(m_window).to(self.device)

            with torch.no_grad():
                pred = self.inpaint_model(t_x, t_m).cpu().numpy()[0, :sub_len]

            for offset in range(sub_len):
                frame_idx = start + offset
                if mask[frame_idx]:
                    px = float(pred[offset, 0] * frame_width)
                    py = float(pred[offset, 1] * frame_height)
                    out_coords[frame_idx] = (px, py)

        return out_coords

    def _ballistic_inpaint(
        self,
        coords: list[tuple[float, float] | None],
        mask: np.ndarray,
    ) -> list[tuple[float, float] | None]:
        """
        Hermite / quadratic ballistic spline fallback matching position and
        velocity vectors at the gap boundaries.
        """
        n = len(coords)
        out_coords = list(coords)

        i = 0
        while i < n:
            if mask[i]:
                j = i
                while j < n and mask[j]:
                    j += 1

                # Gap range is [i, j - 1]
                p0 = coords[i - 1] if i > 0 else None
                p1 = coords[j] if j < n else None

                if p0 is not None and p1 is not None:
                    # Estimate velocities at endpoints if context available
                    v0 = (
                        (p0[0] - coords[i - 2][0], p0[1] - coords[i - 2][1])
                        if (i >= 2 and coords[i - 2] is not None)
                        else (0.0, 0.0)
                    )
                    v1 = (
                        (coords[j + 1][0] - p1[0], coords[j + 1][1] - p1[1])
                        if (j + 1 < n and coords[j + 1] is not None)
                        else (0.0, 0.0)
                    )

                    gap_len = j - i
                    for k in range(gap_len):
                        t = (k + 1) / (gap_len + 1)
                        # Cubic Hermite basis functions
                        h00 = 2 * t**3 - 3 * t**2 + 1
                        h10 = t**3 - 2 * t**2 + t
                        h01 = -2 * t**3 + 3 * t**2
                        h11 = t**3 - t**2

                        scale = float(gap_len)
                        ix = h00 * p0[0] + h10 * v0[0] * scale + h01 * p1[0] + h11 * v1[0] * scale
                        iy = h00 * p0[1] + h10 * v0[1] * scale + h01 * p1[1] + h11 * v1[1] * scale
                        out_coords[i + k] = (float(ix), float(iy))

                i = j
            else:
                i += 1

        return out_coords
