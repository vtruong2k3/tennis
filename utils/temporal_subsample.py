"""
utils/temporal_subsample.py
───────────────────────────
Provides temporal subsampling for high-FPS video (e.g. 50-60+ fps) and
interpolation utilities to upsample telemetry and annotations back to the
original high-FPS timeline.

Why this exists
---------------
The pipeline's event detectors and machine learning models (TrackNet,
hit/bounce classifier) were trained and calibrated on ~30 fps footage.
Running them on native 60 fps cuts the per-frame pixel velocities in half,
causing the logistic regression model to misclassify hits as bounces and
doubling the inference workload.

By subsampling frames with stride = round(fps / 30.0), the AI pipeline
operates in its calibrated ~30 fps domain. The results (bounding boxes,
court points, event frames, and statistics) can then be interpolated
back to the original 60 fps timeline so that output video and frontend
telemetry remain buttery smooth at full 60 fps without any warning banner.
"""
from __future__ import annotations

import logging
from typing import Any
import numpy as np
import pandas as pd

logger = logging.getLogger(__name__)


def get_subsample_stride(fps: float | None) -> int:
    """
    Determine the temporal subsampling factor (stride) for high-FPS video.

    Args:
        fps: Source video frame rate from header.

    Returns:
        1 for standard frame rates (< 48 fps) or unreadable headers,
        2 for ~50-65 fps,
        >= 3 for higher frame rates (e.g. 120 fps -> 4).
    """
    if not fps or fps <= 0:
        return 1
    if fps >= 48.0:
        return max(1, int(round(fps / 30.0)))
    return 1


def subsample_frames(frames: list[np.ndarray], stride: int) -> list[np.ndarray]:
    """
    Subsample frames by stride. Returns a list slice (view).

    Args:
        frames: List of image arrays.
        stride: Step size (1 = no-op).

    Returns:
        Subsampled list of frames.
    """
    if stride <= 1 or not frames:
        return frames
    return frames[::stride]


def interpolate_bboxes(
    detections: list[dict],
    target_length: int,
    stride: int,
) -> list[dict]:
    """
    Upsample frame-by-frame detections from subsampled analysis length to target length.

    Args:
        detections: List of {id: [x1, y1, x2, y2]} of length M.
        target_length: N, the original video frame count.
        stride: Subsampling factor (e.g. 2).

    Returns:
        List of {id: [x1, y1, x2, y2]} of length target_length.
    """
    if stride <= 1 or not detections:
        return detections

    n_source = len(detections)
    if n_source == target_length:
        return detections

    result: list[dict] = []
    for t in range(target_length):
        u = t / stride
        k = int(u)
        frac = u - k

        if frac == 0 or k >= n_source - 1:
            idx = min(k, n_source - 1)
            result.append(dict(detections[idx]))
        else:
            k_next = k + 1
            det_k = detections[k]
            det_next = detections[k_next]

            interp_dict: dict[Any, list[float]] = {}
            all_ids = set(det_k.keys()) | set(det_next.keys())
            for obj_id in all_ids:
                if obj_id in det_k and obj_id in det_next:
                    box_k = det_k[obj_id]
                    box_next = det_next[obj_id]
                    interp_box = [
                        float((1.0 - frac) * box_k[c] + frac * box_next[c])
                        for c in range(4)
                    ]
                    interp_dict[obj_id] = interp_box
                elif obj_id in det_k and frac < 0.5:
                    interp_dict[obj_id] = list(det_k[obj_id])
                elif obj_id in det_next and frac >= 0.5:
                    interp_dict[obj_id] = list(det_next[obj_id])
            result.append(interp_dict)

    return result


def interpolate_points_dict(
    points_dict: dict[int, dict],
    target_length: int,
    stride: int,
) -> dict[int, dict]:
    """
    Upsample {frame_idx: {id: (x, y)}} to target_length frames.
    Used for player_mini_court and ball_mini_court.
    """
    if stride <= 1 or not points_dict:
        return points_dict

    result: dict[int, dict] = {}
    for t in range(target_length):
        u = t / stride
        k = int(u)
        frac = u - k

        pts_k = points_dict.get(k, {})
        pts_next = points_dict.get(k + 1, {})

        if frac == 0 or not pts_next:
            if pts_k:
                result[t] = dict(pts_k)
        else:
            interp_pts = {}
            all_ids = set(pts_k.keys()) | set(pts_next.keys())
            for obj_id in all_ids:
                if obj_id in pts_k and obj_id in pts_next:
                    p1 = pts_k[obj_id]
                    p2 = pts_next[obj_id]
                    interp_pts[obj_id] = (
                        float((1.0 - frac) * p1[0] + frac * p2[0]),
                        float((1.0 - frac) * p1[1] + frac * p2[1]),
                    )
                elif obj_id in pts_k and frac < 0.5:
                    interp_pts[obj_id] = pts_k[obj_id]
                elif obj_id in pts_next and frac >= 0.5:
                    interp_pts[obj_id] = pts_next[obj_id]
            if interp_pts:
                result[t] = interp_pts
    return result


def upsample_event_frames(event_frames: list[int] | set[int], stride: int) -> list[int]:
    """Map analysis frame indices to original timeline: f_orig = f_analysis * stride."""
    if stride <= 1:
        return sorted(list(event_frames))
    return sorted([int(f * stride) for f in event_frames])


def upsample_event_dict(event_dict: dict[int, Any], stride: int) -> dict[int, Any]:
    """Map event dict keys: {f_orig: val} where f_orig = f_analysis * stride."""
    if stride <= 1:
        return dict(event_dict)
    return {int(f * stride): val for f, val in event_dict.items()}


def upsample_stats_df(
    stats_df: pd.DataFrame,
    target_length: int,
    stride: int,
) -> pd.DataFrame:
    """
    Expand stats_df to match original frame count by forward/nearest filling.
    Ensures frame_num runs from 0 to target_length - 1.
    """
    if stride <= 1 or stats_df.empty or len(stats_df) == target_length:
        return stats_df

    m = len(stats_df)
    rows = []
    for t in range(target_length):
        k = min(m - 1, int(round(t / stride)))
        row = stats_df.iloc[k].copy()
        if "frame_num" in row:
            row["frame_num"] = t
        rows.append(row)

    return pd.DataFrame(rows).reset_index(drop=True)


def upsample_keypoints(keypoints: Any, target_length: int, stride: int) -> Any:
    """Upsample per-frame court keypoints list if needed."""
    if stride <= 1 or not isinstance(keypoints, (list, tuple)):
        return keypoints
    if len(keypoints) == target_length:
        return keypoints
    m = len(keypoints)
    return [keypoints[min(m - 1, int(round(t / stride)))] for t in range(target_length)]


def refine_contact_frames_to_native_fps(
    contact_frames: list[int] | set[int],
    ball_detections: list[dict],
    player_detections: list[dict] | None = None,
    audio_candidates: list[int] | None = None,
    stride: int = 2,
    search_radius: int | None = None,
) -> list[int]:
    """
    Refine contact frames to full high-FPS (e.g. 60Hz / 16.6ms) precision.

    When video is subsampled (stride >= 2), nominal native contact frames
    (f_sub * stride) are quantized to multiples of stride (33.3ms intervals).
    This function examines the local neighborhood around each candidate:
      1. Snapping to an acoustic transient (audio impact) if within search radius (<5ms onset).
      2. Otherwise finding the frame of maximum trajectory inflection / acceleration
         and minimum ball-to-player distance in native detections.

    Args:
        contact_frames: List of nominal native contact frames (already upsampled by stride).
        ball_detections: Per-frame native {1: [x1, y1, x2, y2]} detections.
        player_detections: Optional per-frame native player detections.
        audio_candidates: Optional frame indices from acoustic impact detector.
        stride: Temporal stride used during subsampling.
        search_radius: Max frame offset to search (defaults to max(1, stride - 1)).

    Returns:
        List of refined contact frame indices with full native FPS precision.
    """
    if not contact_frames:
        return []

    radius = search_radius if search_radius is not None else max(1, stride - 1)
    n_frames = len(ball_detections)

    def _ball_center(f: int) -> tuple[float, float] | None:
        if 0 <= f < n_frames:
            bbox = ball_detections[f].get(1)
            if bbox is not None:
                return ((bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0)
        return None

    def _min_player_dist(f: int, bx: float, by: float) -> float:
        if not player_detections or f < 0 or f >= len(player_detections):
            return 0.0
        players = player_detections[f]
        if not players:
            return 0.0
        dists = []
        for box in players.values():
            dx = max(box[0] - bx, 0.0, bx - box[2])
            dy = max(box[1] - by, 0.0, by - box[3])
            dists.append((dx * dx + dy * dy) ** 0.5)
        return min(dists) if dists else 0.0

    refined: list[int] = []
    for f_nom in sorted(contact_frames):
        # 1. Acoustic impact check (highest physical precision <5ms)
        if audio_candidates:
            audio_matches = [a for a in audio_candidates if abs(a - f_nom) <= max(radius, stride)]
            if audio_matches:
                closest_audio = min(audio_matches, key=lambda a: abs(a - f_nom))
                refined.append(int(closest_audio))
                continue

        # 2. Visual trajectory & player proximity check
        window_lo = max(0, f_nom - radius)
        window_hi = min(n_frames - 1, f_nom + radius)

        best_frame = f_nom
        best_score = -float("inf")

        for f in range(window_lo, window_hi + 1):
            curr_pos = _ball_center(f)
            if curr_pos is None:
                score = -50.0 - abs(f - f_nom) * 2.0
            else:
                prev_pos = _ball_center(f - 1)
                next_pos = _ball_center(f + 1)
                impulse = 0.0
                if prev_pos is not None and next_pos is not None:
                    vx_in = curr_pos[0] - prev_pos[0]
                    vy_in = curr_pos[1] - prev_pos[1]
                    vx_out = next_pos[0] - curr_pos[0]
                    vy_out = next_pos[1] - curr_pos[1]
                    dvx = vx_out - vx_in
                    dvy = vy_out - vy_in
                    impulse = (dvx * dvx + dvy * dvy) ** 0.5

                p_dist = _min_player_dist(f, curr_pos[0], curr_pos[1])
                score = impulse - (p_dist * 0.1) - (abs(f - f_nom) * 0.5)

            if score > best_score:
                best_score = score
                best_frame = f

        refined.append(int(best_frame))

    return sorted(list(set(refined)))


def upsample_and_refine_event_dict(
    event_dict: dict[int, Any],
    ball_detections: list[dict],
    player_detections: list[dict] | None = None,
    audio_candidates: list[int] | None = None,
    stride: int = 2,
    search_radius: int | None = None,
) -> dict[int, Any]:
    """
    Upsample event dict and refine contact keys to native high-FPS timestamps.
    """
    if stride <= 1 and not audio_candidates:
        return dict(event_dict)

    result = {}
    for f_sub, val in event_dict.items():
        f_nom = int(f_sub * stride)
        refined_list = refine_contact_frames_to_native_fps(
            [f_nom],
            ball_detections=ball_detections,
            player_detections=player_detections,
            audio_candidates=audio_candidates,
            stride=stride,
            search_radius=search_radius,
        )
        target_f = refined_list[0] if refined_list else f_nom
        result[target_f] = val
    return result
