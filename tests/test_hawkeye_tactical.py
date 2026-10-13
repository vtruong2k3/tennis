"""
tests/test_hawkeye_tactical.py
──────────────────────────────
Test suite for Hawkeye Electronic Line Calling (ELC) and
tactical player movement telemetry.
"""
from __future__ import annotations

import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.hawkeye import (
    COURT_LENGTH_M,
    DOUBLES_WIDTH_M,
    SINGLES_LEFT_M,
    SINGLES_RIGHT_M,
    call_bounce,
)
from utils.tactical_metrics import compute_tactical_metrics


# ── 1. Hawkeye Line Calling Tests ─────────────────────────────────────────────

def test_hawkeye_clean_in():
    """Ball landing well inside the singles court boundary."""
    # Near center of near court
    call = call_bounce(bounce_x_m=5.0, bounce_y_m=15.0, match_type="singles")
    assert call.is_in is True
    assert call.decision == "IN"
    assert call.distance_to_line_cm < 0  # Negative = inside
    assert "IN by" in call.margin_text


def test_hawkeye_touching_baseline():
    """Ball landing right on the near baseline edge."""
    # Near baseline is at 23.77 m
    call = call_bounce(bounce_x_m=5.0, bounce_y_m=COURT_LENGTH_M - 0.02, match_type="singles")
    assert call.is_in is True
    assert call.decision == "TOUCHING_LINE"
    assert "TOUCHING LINE" in call.margin_text


def test_hawkeye_out_long():
    """Ball landing 20 cm past the baseline."""
    call = call_bounce(bounce_x_m=5.0, bounce_y_m=COURT_LENGTH_M + 0.20, match_type="singles")
    assert call.is_in is False
    assert call.decision == "OUT"
    assert call.distance_to_line_cm > 0  # Positive = outside
    assert "OUT by" in call.margin_text


def test_hawkeye_doubles_alley_difference():
    """Ball landing in the doubles alley (between 0.0 and 1.37 m)."""
    # Alley point: x = 0.80 m, y = 15.0 m
    call_singles = call_bounce(bounce_x_m=0.80, bounce_y_m=15.0, match_type="singles")
    call_doubles = call_bounce(bounce_x_m=0.80, bounce_y_m=15.0, match_type="doubles")

    # In singles, the alley is OUT
    assert call_singles.is_in is False
    assert call_singles.decision == "OUT"

    # In doubles, the alley is IN
    assert call_doubles.is_in is True
    assert call_doubles.decision == "IN"


def test_hawkeye_legal_serve():
    """Serve landing legally in the near service box."""
    # Serving from far baseline (y = 0) to near service box (y between 11.885 and 18.29 m)
    call = call_bounce(
        bounce_x_m=5.0,
        bounce_y_m=15.0,
        is_serve=True,
        server_y_m=1.0,
    )
    assert call.is_in is True
    assert "SERVICE IN" in call.margin_text


def test_hawkeye_fault_serve_past_service_line():
    """Serve landing past the service line (fault)."""
    call = call_bounce(
        bounce_x_m=5.0,
        bounce_y_m=19.5,  # Past near service line (18.29 m)
        is_serve=True,
        server_y_m=1.0,
    )
    assert call.is_in is False
    assert call.decision == "OUT"
    assert "FAULT" in call.margin_text


# ── 2. Tactical Metrics Tests ─────────────────────────────────────────────────

def test_tactical_metrics_computation():
    """Verify player distance, speed, and court zone proportions."""
    fps = 30.0
    # Simulate a player running along the baseline for 60 frames (2 seconds)
    # Moving from x=3.0 to x=8.0 (5 metres) at constant speed
    positions = [(3.0 + (i / 60.0) * 5.0, 22.5) for i in range(60)]

    profile = compute_tactical_metrics(
        player_positions_m=positions,
        player_id=1,
        fps=fps,
        court_side="near",
    )

    assert profile.player_id == 1
    assert 4.5 <= profile.total_distance_m <= 5.5
    assert profile.average_speed_kmh > 0.0
    # Player spent all time deep at the baseline
    assert profile.baseline_time_pct >= 90.0
    assert profile.net_time_pct == 0.0

    d = profile.to_dict()
    assert "total_distance_m" in d
    assert "peak_speed_kmh" in d
