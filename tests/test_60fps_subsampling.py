"""
tests/test_60fps_subsampling.py
───────────────────────────────
Tests for temporal subsampling and interpolation used for 60fps+ video support.
"""
import numpy as np
import pandas as pd
import pytest

from utils.fps_support import (
    SUPPORTED,
    PARTIALLY_SUPPORTED,
    UNSUPPORTED,
    assess_fps,
    assess_fps_with_subsampling,
)
from utils.temporal_subsample import (
    get_subsample_stride,
    subsample_frames,
    interpolate_bboxes,
    interpolate_points_dict,
    upsample_event_frames,
    upsample_event_dict,
    upsample_stats_df,
    upsample_keypoints,
)


# ── 1. Stride calculation ──────────────────────────────────────────────────

@pytest.mark.parametrize("fps,expected_stride", [
    (None, 1),
    (0, 1),
    (24.0, 1),
    (25.0, 1),
    (29.97, 1),
    (30.0, 1),
    (40.0, 1),
    (47.9, 1),
    (48.0, 2),
    (50.0, 2),
    (59.94, 2),
    (60.0, 2),
    (90.0, 3),
    (120.0, 4),
    (240.0, 8),
])
def test_get_subsample_stride(fps, expected_stride):
    assert get_subsample_stride(fps) == expected_stride


# ── 2. assess_fps_with_subsampling ─────────────────────────────────────────

def test_assess_fps_with_subsampling_standard_rates():
    stride, support = assess_fps_with_subsampling(30.0)
    assert stride == 1
    assert support.status == SUPPORTED
    assert support.stride == 1
    assert support.is_supported is True


def test_assess_fps_with_subsampling_60fps():
    stride, support = assess_fps_with_subsampling(60.0)
    assert stride == 2
    assert support.status == SUPPORTED
    assert support.is_supported is True
    assert support.stride == 2
    assert support.effective_fps == 30.0
    assert "2x temporal subsampling" in support.reason

    payload = support.as_dict()
    assert payload["status"] == SUPPORTED
    assert payload["subsample_stride"] == 2
    assert payload["effective_fps"] == 30.0


def test_assess_fps_with_subsampling_50fps():
    stride, support = assess_fps_with_subsampling(50.0)
    assert stride == 2
    assert support.status == SUPPORTED
    assert support.effective_fps == 25.0


def test_assess_fps_with_subsampling_unreadable():
    stride, support = assess_fps_with_subsampling(None)
    assert stride == 1
    assert support.status == UNSUPPORTED


# ── 3. Frame subsampling ────────────────────────────────────────────────────

def test_subsample_frames():
    frames = [np.zeros((10, 10, 3), dtype=np.uint8) for _ in range(10)]
    assert len(subsample_frames(frames, stride=1)) == 10
    sub = subsample_frames(frames, stride=2)
    assert len(sub) == 5


# ── 4. Bounding box interpolation ──────────────────────────────────────────

def test_interpolate_bboxes():
    # 3 analysis frames -> upsample to 5 frames with stride 2
    # Frame 0: [0, 0, 10, 10]
    # Frame 1: [10, 20, 30, 40]
    # Frame 2: [20, 40, 50, 70]
    dets = [
        {1: [0.0, 0.0, 10.0, 10.0], 2: [100.0, 100.0, 120.0, 120.0]},
        {1: [10.0, 20.0, 30.0, 40.0], 2: [100.0, 110.0, 120.0, 130.0]},
        {1: [20.0, 40.0, 50.0, 70.0], 2: [100.0, 120.0, 120.0, 140.0]},
    ]
    interp = interpolate_bboxes(dets, target_length=5, stride=2)
    assert len(interp) == 5

    # Even frames (0, 2, 4) should match original
    assert interp[0][1] == [0.0, 0.0, 10.0, 10.0]
    assert interp[2][1] == [10.0, 20.0, 30.0, 40.0]
    assert interp[4][1] == [20.0, 40.0, 50.0, 70.0]

    # Odd frame 1 should be midway between frame 0 and frame 1
    expected_mid = [(0 + 10) / 2, (0 + 20) / 2, (10 + 30) / 2, (10 + 40) / 2]
    assert interp[1][1] == pytest.approx(expected_mid)


# ── 5. Point dictionary interpolation ──────────────────────────────────────

def test_interpolate_points_dict():
    pts = {
        0: {1: (0.0, 0.0)},
        1: {1: (10.0, 20.0)},
        2: {1: (20.0, 40.0)},
    }
    interp = interpolate_points_dict(pts, target_length=5, stride=2)
    assert len(interp) == 5
    assert interp[0][1] == (0.0, 0.0)
    assert interp[1][1] == pytest.approx((5.0, 10.0))
    assert interp[2][1] == (10.0, 20.0)


# ── 6. Event frames and dict upsampling ───────────────────────────────────

def test_upsample_event_frames():
    events = [3, 10, 25]
    assert upsample_event_frames(events, stride=2) == [6, 20, 50]
    assert upsample_event_frames(events, stride=1) == [3, 10, 25]


def test_upsample_event_dict():
    d = {3: "Serve", 10: "Forehand"}
    up = upsample_event_dict(d, stride=2)
    assert up == {6: "Serve", 20: "Forehand"}


# ── 7. Stats DataFrame upsampling ──────────────────────────────────────────

def test_upsample_stats_df():
    df = pd.DataFrame({
        "frame_num": [0, 1, 2],
        "player_1_speed": [15.0, 18.0, 20.0],
    })
    up = upsample_stats_df(df, target_length=5, stride=2)
    assert len(up) == 5
    assert list(up["frame_num"]) == [0, 1, 2, 3, 4]
    # Frame 1 gets value from analysis row 1 (since round(1/2) == 0 or 1)
    assert "player_1_speed" in up.columns


# ── 8. High-FPS 16.6ms contact refinement ─────────────────────────────────

def test_refine_contact_frames_snaps_to_audio():
    from utils.temporal_subsample import refine_contact_frames_to_native_fps

    # Nominal 30fps event 10 mapped to native 60fps frame 20
    # Acoustic transient occurred at frame 21 (16.6ms offset, odd frame)
    ball_detections = [{1: [500.0, 500.0, 520.0, 520.0]} for _ in range(40)]
    refined = refine_contact_frames_to_native_fps(
        contact_frames=[20],
        ball_detections=ball_detections,
        audio_candidates=[21],
        stride=2,
    )
    assert refined == [21]


def test_refine_contact_frames_snaps_to_trajectory_inflection():
    from utils.temporal_subsample import refine_contact_frames_to_native_fps

    # Trajectory with sharp inflection at frame 31 (odd frame!)
    # Frames 28-30: ball moving down (+15 px/f)
    # Frame 31: ball hits racket and reverses (-15 px/f)
    ball_detections = []
    for f in range(60):
        if f <= 31:
            y = 200.0 + f * 15.0
        else:
            y = 200.0 + 31 * 15.0 - (f - 31) * 15.0
        ball_detections.append({1: [500.0, y, 520.0, y + 20.0]})

    # Nominal frame was 30 (from subsampled 15 * 2)
    refined = refine_contact_frames_to_native_fps(
        contact_frames=[30],
        ball_detections=ball_detections,
        stride=2,
    )
    assert refined == [31]


def test_upsample_and_refine_event_dict():
    from utils.temporal_subsample import upsample_and_refine_event_dict

    # Dict at 30fps: {15: "Forehand"} -> nominal 30, refined to 31
    ball_detections = []
    for f in range(60):
        if f <= 31:
            y = 200.0 + f * 15.0
        else:
            y = 200.0 + 31 * 15.0 - (f - 31) * 15.0
        ball_detections.append({1: [500.0, y, 520.0, y + 20.0]})

    refined_dict = upsample_and_refine_event_dict(
        event_dict={15: "Forehand"},
        ball_detections=ball_detections,
        stride=2,
    )
    assert refined_dict == {31: "Forehand"}
