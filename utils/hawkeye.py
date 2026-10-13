"""
utils/hawkeye.py
────────────────
Hawkeye Electronic Line Calling (ELC) and In/Out Decision Engine.

Accurately judges whether a ball bounce is IN, OUT, or TOUCHING THE LINE
according to official International Tennis Federation (ITF) rules:
- Singles court: 23.77 m x 8.23 m
- Doubles court: 23.77 m x 10.97 m
- Service boxes: 6.40 m x 4.115 m
- Ball radius: 3.35 cm (6.7 cm diameter)
- Line width: 5 cm (sidelines, service lines), up to 10 cm (baselines)

According to ITF rules:
"If a ball touches a line, it is regarded as touching the court bounded by that line (Rule 12 - Ball Touches Line)."
Any overlap between the tennis ball contact patch and the outer edge of the line constitutes a valid IN shot.
"""
from __future__ import annotations

import math
from dataclasses import dataclass
from typing import Literal

import cv2
import numpy as np

import constants


# ── ITF Court Geometry (Metres) ──────────────────────────────────────────────
COURT_LENGTH_M          = 23.77
DOUBLES_WIDTH_M         = 10.97
SINGLES_WIDTH_M         = 8.23
ALLEY_WIDTH_M           = (DOUBLES_WIDTH_M - SINGLES_WIDTH_M) / 2.0  # 1.37 m

SINGLES_LEFT_M          = ALLEY_WIDTH_M                               # 1.37 m
SINGLES_RIGHT_M         = ALLEY_WIDTH_M + SINGLES_WIDTH_M             # 9.60 m
DOUBLES_LEFT_M          = 0.0
DOUBLES_RIGHT_M         = DOUBLES_WIDTH_M                             # 10.97 m

FAR_BASELINE_Y_M        = 0.0
NET_Y_M                 = COURT_LENGTH_M / 2.0                        # 11.885 m
NEAR_BASELINE_Y_M       = COURT_LENGTH_M                              # 23.77 m

SERVICE_LINE_FAR_Y_M    = constants.NO_MANS_LAND_HEIGHT               # 5.48 m
SERVICE_LINE_NEAR_Y_M   = COURT_LENGTH_M - constants.NO_MANS_LAND_HEIGHT  # 18.29 m
CENTER_SERVICE_LINE_X_M = DOUBLES_WIDTH_M / 2.0                       # 5.485 m

# Physics constants
BALL_RADIUS_M           = 0.0335  # ~3.35 cm radius
LINE_WIDTH_M            = 0.05    # 5 cm standard lines
BASELINE_WIDTH_M        = 0.10    # 10 cm baseline


@dataclass(frozen=True)
class HawkeyeCall:
    """Decision output for a single court bounce event."""
    is_in: bool
    decision: Literal["IN", "OUT", "TOUCHING_LINE"]
    distance_to_line_cm: float     # Positive = OUT by X cm; Negative = IN by X cm
    nearest_line: str              # e.g., 'far_baseline', 'right_singles_sideline'
    ball_center_m: tuple[float, float]
    margin_text: str               # Human-readable call text (e.g. "OUT by 4.2 cm")

    @property
    def is_close_call(self) -> bool:
        """True if the ball landed within 10 cm of a line (crucial for review)."""
        return abs(self.distance_to_line_cm) <= 10.0


def call_bounce(
    bounce_x_m: float | tuple[float, float] | list[float],
    bounce_y_m: float | None = None,
    match_type: Literal["singles", "doubles"] = "singles",
    is_serve: bool = False,
    server_y_m: float | None = None,
    server_side_left: bool | None = None,
    is_service: bool | None = None,
    is_doubles: bool | None = None,
) -> HawkeyeCall:
    """
    Evaluates whether a bounce landed IN, OUT, or TOUCHING THE LINE.

    Args:
        bounce_x_m: Ball bounce X position in court meters (or (x, y) tuple).
        bounce_y_m: Ball bounce Y position in court meters.
        match_type: 'singles' or 'doubles'.
        is_serve: True if this bounce is the landing of a serve.
        server_y_m: Server's Y coordinate.
        server_side_left: True if serving from the left side.
    """
    if isinstance(bounce_x_m, (tuple, list)):
        bx, by = float(bounce_x_m[0]), float(bounce_x_m[1])
    else:
        bx = float(bounce_x_m)
        by = float(bounce_y_m) if bounce_y_m is not None else 0.0

    if is_service is not None:
        is_serve = is_service
    if is_doubles is not None:
        match_type = "doubles" if is_doubles else "singles"

    # ── 1. Serve Service-Box Check ───────────────────────────────────────────
    if is_serve:
        return _call_serve_bounce(bx, by, server_y_m, server_side_left)

    # ── 2. General Rally Groundstroke Check ──────────────────────────────────
    left_x = SINGLES_LEFT_M if match_type == "singles" else DOUBLES_LEFT_M
    right_x = SINGLES_RIGHT_M if match_type == "singles" else DOUBLES_RIGHT_M
    top_y = FAR_BASELINE_Y_M
    bottom_y = NEAR_BASELINE_Y_M

    # Distances to the 4 court boundary lines:
    # A negative value means inside the court; positive means outside.
    dist_left   = left_x - bx
    dist_right  = bx - right_x
    dist_top    = top_y - by
    dist_bottom = by - bottom_y

    distances = [
        (dist_left, f"left_{match_type}_sideline"),
        (dist_right, f"right_{match_type}_sideline"),
        (dist_top, "far_baseline"),
        (dist_bottom, "near_baseline"),
    ]

    # Find the boundary line where the ball is closest to the outside
    max_dist, nearest_line = max(distances, key=lambda t: t[0])
    effective_line_width = BASELINE_WIDTH_M if "baseline" in nearest_line else LINE_WIDTH_M

    # Distance relative to the outer edge of the boundary line
    # (Ball radius allows overlapping with the line)
    margin_to_outer_edge_m = max_dist - BALL_RADIUS_M
    margin_cm = round(margin_to_outer_edge_m * 100.0, 1)

    if margin_to_outer_edge_m > 0.0:
        # Ball landed completely outside the line
        decision = "OUT"
        is_in = False
        margin_text = f"OUT by {margin_cm:.1f} cm"
    elif abs(margin_to_outer_edge_m) <= (effective_line_width + BALL_RADIUS_M):
        # Ball touches the line
        decision = "TOUCHING_LINE"
        is_in = True
        margin_text = f"TOUCHING LINE ({abs(margin_cm):.1f} cm in)"
    else:
        # Ball safely inside
        decision = "IN"
        is_in = True
        margin_text = f"IN by {abs(margin_cm):.1f} cm"

    return HawkeyeCall(
        is_in=is_in,
        decision=decision,
        distance_to_line_cm=margin_cm,
        nearest_line=nearest_line,
        ball_center_m=(bx, by),
        margin_text=margin_text,
    )


def _call_serve_bounce(
    bx: float,
    by: float,
    server_y_m: float | None = None,
    server_side_left: bool | None = None,
) -> HawkeyeCall:
    """Specialized evaluation for serve landings inside the legal service box."""
    # Determine which half the serve must land in
    server_is_far = (server_y_m is None) or (server_y_m < NET_Y_M)

    if server_is_far:
        # Serving to the near half (between net and near service line)
        y_min = NET_Y_M
        y_max = SERVICE_LINE_NEAR_Y_M
    else:
        # Serving to the far half (between far service line and net)
        y_min = SERVICE_LINE_FAR_Y_M
        y_max = NET_Y_M

    x_min = SINGLES_LEFT_M
    x_max = SINGLES_RIGHT_M

    dist_x_left   = x_min - bx
    dist_x_right  = bx - x_max
    dist_y_top    = y_min - by
    dist_y_bottom = by - y_max

    distances = [
        (dist_x_left, "singles_sideline"),
        (dist_x_right, "singles_sideline"),
        (dist_y_top, "net_or_service_line"),
        (dist_y_bottom, "service_line"),
    ]

    max_dist, nearest_line = max(distances, key=lambda t: t[0])
    margin_m = max_dist - BALL_RADIUS_M
    margin_cm = round(margin_m * 100.0, 1)

    if margin_m > 0.0:
        decision = "OUT"
        is_in = False
        margin_text = f"FAULT (OUT by {margin_cm:.1f} cm)"
    elif abs(margin_m) <= (LINE_WIDTH_M + BALL_RADIUS_M):
        decision = "TOUCHING_LINE"
        is_in = True
        margin_text = f"SERVICE IN ({abs(margin_cm):.1f} cm on line)"
    else:
        decision = "IN"
        is_in = True
        margin_text = f"SERVICE IN by {abs(margin_cm):.1f} cm"

    return HawkeyeCall(
        is_in=is_in,
        decision=decision,
        distance_to_line_cm=margin_cm,
        nearest_line=nearest_line,
        ball_center_m=(bx, by),
        margin_text=margin_text,
    )


def draw_hawkeye_badge(
    frame: np.ndarray,
    call: HawkeyeCall,
    position: tuple[int, int] = (40, 80),
) -> np.ndarray:
    """Renders a broadcast-style Hawkeye review banner on a video frame."""
    x, y = position
    color = (0, 200, 0) if call.is_in else (0, 0, 230)  # Green for IN, Red for OUT
    text = f"HAWKEYE: {call.decision} - {call.margin_text}"

    # Draw dark backing rectangle
    text_size, _ = cv2.getTextSize(text, cv2.FONT_HERSHEY_DUPLEX, 0.7, 2)
    w, h = text_size[0] + 20, text_size[1] + 16
    cv2.rectangle(frame, (x - 5, y - h + 5), (x + w, y + 10), (20, 20, 20), -1)
    cv2.rectangle(frame, (x - 5, y - h + 5), (x + w, y + 10), color, 2)

    # Draw text
    cv2.putText(frame, text, (x + 5, y), cv2.FONT_HERSHEY_DUPLEX, 0.7, color, 2, cv2.LINE_AA)
    return frame
