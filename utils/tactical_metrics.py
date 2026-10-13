"""
utils/tactical_metrics.py
─────────────────────────
Tactical court telemetry and player movement analytics.

Computes:
1. Total distance run (metres / km) for each player
2. Instantaneous and peak sprint speeds (km/h)
3. Court Zone Positioning distribution:
   - Baseline Zone (deep baseline defending)
   - Transition Zone ("No-man's land" / mid-court)
   - Net Zone (aggressive forward net approach)
4. Lateral vs Depth movement ratio
5. 2D Spatial Occupancy Heatmap matrix
"""
from __future__ import annotations

import math
from dataclasses import dataclass, field
from typing import Sequence

import numpy as np

from .hawkeye import COURT_LENGTH_M, DOUBLES_WIDTH_M, NET_Y_M


@dataclass
class PlayerTacticalProfile:
    """Tactical profile and movement statistics for a single player."""
    player_id: int
    total_distance_m: float = 0.0
    average_speed_kmh: float = 0.0
    peak_speed_kmh: float = 0.0
    baseline_time_pct: float = 0.0
    transition_time_pct: float = 0.0
    net_time_pct: float = 0.0
    lateral_distance_m: float = 0.0
    depth_distance_m: float = 0.0
    heatmap_grid: list[list[float]] = field(default_factory=list)

    def to_dict(self) -> dict:
        return {
            "player_id": self.player_id,
            "total_distance_m": round(self.total_distance_m, 2),
            "average_speed_kmh": round(self.average_speed_kmh, 1),
            "peak_speed_kmh": round(self.peak_speed_kmh, 1),
            "baseline_time_pct": round(self.baseline_time_pct, 1),
            "transition_time_pct": round(self.transition_time_pct, 1),
            "net_time_pct": round(self.net_time_pct, 1),
            "lateral_distance_m": round(self.lateral_distance_m, 2),
            "depth_distance_m": round(self.depth_distance_m, 2),
        }


def compute_tactical_metrics(
    player_positions_m: Sequence[tuple[float, float] | None],
    player_id: int,
    fps: float,
    court_side: str = "near",  # "near" or "far"
    grid_res: tuple[int, int] = (20, 40),
) -> PlayerTacticalProfile:
    """
    Computes movement and tactical telemetry from a sequence of court coordinates.

    Args:
        player_positions_m: Sequence of (x_m, y_m) positions in metres, or None if occluded.
        player_id: ID of the player (1 or 2).
        fps: Video frame rate.
        court_side: Primary side of the court the player is stationed on.
        grid_res: (cols, rows) for the 2D occupancy heatmap.
    """
    valid_pts = [(idx, pt) for idx, pt in enumerate(player_positions_m) if pt is not None]
    if len(valid_pts) < 2:
        return PlayerTacticalProfile(player_id=player_id)

    total_dist = 0.0
    lateral_dist = 0.0
    depth_dist = 0.0
    speeds_kmh: list[float] = []

    # Zone counters
    baseline_frames = 0
    transition_frames = 0
    net_frames = 0

    # 2D Heatmap grid (cols x rows)
    cols, rows = grid_res
    heatmap = np.zeros((rows, cols), dtype=np.float32)

    for i in range(len(valid_pts) - 1):
        f0, (x0, y0) = valid_pts[i]
        f1, (x1, y1) = valid_pts[i + 1]

        frame_delta = f1 - f0
        if frame_delta <= 0:
            continue

        dt = frame_delta / fps
        dx = abs(x1 - x0)
        dy = abs(y1 - y0)
        step_dist = math.sqrt(dx**2 + dy**2)

        # Reject impossible teleports (e.g. tracking switch > 35 km/h)
        speed_ms = step_dist / dt
        speed_kmh = speed_ms * 3.6
        if speed_kmh < 38.0:
            total_dist += step_dist
            lateral_dist += dx
            depth_dist += dy
            speeds_kmh.append(speed_kmh)

        # Categorize court zone based on distance to net and baselines
        dist_to_net = abs(y0 - NET_Y_M)
        if dist_to_net <= 3.5:
            net_frames += 1
        elif (court_side == "near" and y0 >= COURT_LENGTH_M - 2.5) or (
            court_side == "far" and y0 <= 2.5
        ):
            baseline_frames += 1
        else:
            transition_frames += 1

        # Populate heatmap grid
        gx = int(np.clip(x0 / DOUBLES_WIDTH_M * cols, 0, cols - 1))
        gy = int(np.clip(y0 / COURT_LENGTH_M * rows, 0, rows - 1))
        heatmap[gy, gx] += 1.0

    # Normalize heatmap
    if heatmap.sum() > 0:
        heatmap /= heatmap.sum()

    total_zone_frames = max(1, baseline_frames + transition_frames + net_frames)
    avg_speed = float(np.mean(speeds_kmh)) if speeds_kmh else 0.0
    peak_speed = float(np.percentile(speeds_kmh, 95)) if len(speeds_kmh) > 5 else (max(speeds_kmh) if speeds_kmh else 0.0)

    return PlayerTacticalProfile(
        player_id=player_id,
        total_distance_m=total_dist,
        average_speed_kmh=avg_speed,
        peak_speed_kmh=peak_speed,
        baseline_time_pct=(baseline_frames / total_zone_frames) * 100.0,
        transition_time_pct=(transition_frames / total_zone_frames) * 100.0,
        net_time_pct=(net_frames / total_zone_frames) * 100.0,
        lateral_distance_m=lateral_dist,
        depth_distance_m=depth_dist,
        heatmap_grid=heatmap.tolist(),
    )
