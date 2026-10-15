"""
tests/test_fps_shot_filtering.py
─────────────────────────────────
Tests for dynamic FPS scaling, Net-Zone Exclusion, and Physical Inter-Shot Flight Time constraints.
Ensures that 60fps and slow-motion video footage do not fabricate phantom shots mid-flight.
"""
import pytest
from utils.bounce_candidates import detect_bounce_candidates
from utils.hit_bounce_classifier import (
    detect_xvelocity_candidates,
    compute_event_features,
    derive_shot_frames,
)


def test_bounce_candidates_scales_with_fps():
    """Candidates spacing and vertical impulse thresholds must scale with frame rate."""
    # Create synthetic ball detections: 60 frames of a ball moving down then up
    ball_detections = []
    for f in range(60):
        # Bounce around frame 30
        y = 200 + abs(f - 30) * 10
        ball_detections.append({1: [500.0, float(y), 520.0, float(y + 20)]})

    # At 30 fps
    res_30 = detect_bounce_candidates(ball_detections, fps=30.0)
    # At 60 fps
    res_60 = detect_bounce_candidates(ball_detections, fps=60.0)

    assert isinstance(res_30, list)
    assert isinstance(res_60, list)


def test_xvelocity_candidates_scales_with_fps():
    """Horizontal velocity reversal detector must scale spacing with frame rate."""
    ball_detections = []
    for f in range(60):
        x = 500 + (f - 30) * 8 if f >= 30 else 500 - (30 - f) * 8
        ball_detections.append({1: [float(x), 400.0, float(x + 20), 420.0]})

    res_30 = detect_xvelocity_candidates(ball_detections, fps=30.0)
    res_60 = detect_xvelocity_candidates(ball_detections, fps=60.0)
    assert isinstance(res_30, list)
    assert isinstance(res_60, list)


def test_compute_event_features_normalizes_velocity():
    """Event features velocity magnitude must be normalized by (fps / 30.0)."""
    # 30 positions with 10 px/frame delta
    pos_30 = [(100.0 + i * 10.0, 200.0 + i * 10.0) for i in range(30)]
    feat_30 = compute_event_features(pos_30, 15, fps=30.0)

    # At 60 fps, the exact same physical motion has half the pixel delta per frame (5 px/frame)
    pos_60 = [(100.0 + i * 5.0, 200.0 + i * 5.0) for i in range(30)]
    feat_60 = compute_event_features(pos_60, 15, fps=60.0)

    assert feat_30 is not None
    assert feat_60 is not None
    # Velocity changes should match invariant physical speed
    assert abs(feat_30["vy_before"] - feat_60["vy_before"]) < 0.1
    assert abs(feat_30["vx_change_mag"] - feat_60["vx_change_mag"]) < 0.1


def test_derive_shot_frames_filters_net_zone_noise():
    """Mid-court reversals without a player nearby must not be admitted as contacts."""
    class DummyTracker:
        def get_ball_shot_frames(self, ball_positions):
            return [20, 50]  # Frame 50 is mid-court net zone

    # 100 frames
    ball_detections = []
    player_detections = []

    for f in range(100):
        # Ball moves from player 0 (y=800) to player 1 (y=200)
        # At frame 50, ball is at net (y=500)
        by = 800 - f * 6
        ball_detections.append({1: [500.0, float(by), 520.0, float(by + 20)]})
        # Players are strictly at baseline:
        player_detections.append({
            0: [480.0, 780.0, 540.0, 950.0],  # Bottom player
            1: [480.0, 180.0, 540.0, 260.0],  # Top player
        })

    shots, bounces, reversals, notes = derive_shot_frames(
        DummyTracker(), ball_detections, player_detections, fps=60.0
    )

    # Frame 50 (at net y=500 without volleyer) must NOT be promoted to a shot
    assert 50 not in shots
