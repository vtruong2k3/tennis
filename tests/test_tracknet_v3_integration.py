"""
tests/test_tracknet_v3_integration.py
─────────────────────────────────────
Comprehensive test suite for the TrackNetV3 perception and InpaintNet
trajectory rectification module.
"""
from __future__ import annotations

import os
import sys

import numpy as np
import pytest
import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from trackers.tracknet_v3 import (
    BackgroundEstimator,
    BallTrackerNet,
    InpaintNetModel,
    TrackNetV3BallTracker,
    TrackNetV3Model,
    TrajectoryRectifier,
    generate_inpaint_mask,
)


# ── 1. Model Forward Passes ───────────────────────────────────────────────────

def test_tracknet_v3_model_forward():
    """Verify TrackNetV3 forward pass produces expected heatmap shape."""
    model = TrackNetV3Model(in_dim=9, out_dim=3)
    model.eval()

    # Synthetic batch of 2, 9 channels (3 frames x 3 channels), 144x256
    dummy_input = torch.randn(2, 9, 144, 256)
    with torch.no_grad():
        out = model(dummy_input)

    assert out.shape == (2, 3, 144, 256)
    assert (out >= 0.0).all() and (out <= 1.0).all(), "Sigmoid output should be in [0, 1]"


def test_tracknet_v3_model_with_background_channels():
    """Verify TrackNetV3 with 12 input channels (9 frames + 3 background channels)."""
    model = TrackNetV3Model(in_dim=12, out_dim=3)
    model.eval()

    dummy_input = torch.randn(1, 12, 144, 256)
    with torch.no_grad():
        out = model(dummy_input)

    assert out.shape == (1, 3, 144, 256)


def test_inpaint_net_forward():
    """Verify InpaintNet forward pass predicts 2D coordinates for masked frames."""
    inpaint_net = InpaintNetModel(in_dim=3, out_dim=2)
    inpaint_net.eval()

    seq_len = 16
    dummy_x = torch.rand(2, seq_len, 2)
    dummy_mask = torch.zeros(2, seq_len, 1)
    dummy_mask[:, 6:10, :] = 1.0  # Occluded gap between frame 6 and 10

    with torch.no_grad():
        rectified = inpaint_net(dummy_x, dummy_mask)

    assert rectified.shape == (2, seq_len, 2)
    assert (rectified >= 0.0).all() and (rectified <= 1.0).all()


# ── 2. Background Estimation ──────────────────────────────────────────────────

def test_background_estimator():
    """Test median background calculation from frame stack."""
    estimator = BackgroundEstimator(target_width=64, target_height=36)
    assert not estimator.has_background

    # Create 5 frames where static pixels have value 100, and a moving object exists
    frames = []
    for i in range(10):
        f = np.full((36, 64, 3), 100, dtype=np.uint8)
        # moving square
        f[10:15, i * 4 : i * 4 + 4, :] = 255
        frames.append(f)

    bg = estimator.compute_from_frames(frames, max_samples=10)
    assert estimator.has_background
    assert bg.shape == (36, 64, 3)

    # Median should filter out the moving object and reconstruct the static value 100
    assert np.all(bg == 100)

    # Resized background test
    resized = estimator.get_background(width=128, height=72)
    assert resized.shape == (72, 128, 3)


# ── 3. Occlusion Mask Generation ──────────────────────────────────────────────

def test_generate_inpaint_mask_identifies_occlusion_gap():
    """Ensure inpaint mask flags gaps surrounded by valid detections."""
    # 20 frames: valid frames 0..4, missing 5..8, valid 9..19
    coords: list[tuple[float, float] | None] = [(float(i * 10), 100.0) for i in range(20)]
    for i in range(5, 9):
        coords[i] = None

    mask = generate_inpaint_mask(coords, min_gap=1, max_gap=10, min_context=2)
    assert mask.shape == (20,)
    assert not mask[4]
    assert mask[5] and mask[6] and mask[7] and mask[8]
    assert not mask[9]


def test_generate_inpaint_mask_ignores_edge_missing_without_context():
    """Do not flag beginning or end of clip where context does not exist."""
    coords = [None, None, (10.0, 10.0), (20.0, 20.0), None, None]
    mask = generate_inpaint_mask(coords, min_context=2)
    # Start and end have no context on one side, so shouldn't inpaint
    assert not mask[0] and not mask[1]
    assert not mask[4] and not mask[5]


# ── 4. Trajectory Rectifier Fallback ──────────────────────────────────────────

def test_trajectory_rectifier_ballistic_fallback():
    """Hermite polynomial fallback fills missing frames smoothly between anchors."""
    rectifier = TrajectoryRectifier(inpaint_model=None)

    coords: list[tuple[float, float] | None] = [
        (0.0, 100.0),
        (10.0, 100.0),
        (20.0, 100.0),
        None,  # frame 3
        None,  # frame 4
        (50.0, 100.0),
        (60.0, 100.0),
    ]

    rectified = rectifier.rectify_coordinates(coords, frame_width=640, frame_height=360)

    # All frames should now have non-None coordinates
    assert all(pt is not None for pt in rectified)
    # Check that rectified points lie smoothly between frame 2 (20.0) and frame 5 (50.0)
    p3 = rectified[3]
    p4 = rectified[4]
    assert p3 is not None and p4 is not None
    assert 20.0 < p3[0] < p4[0] < 50.0
    assert abs(p3[1] - 100.0) < 1.0
    assert abs(p4[1] - 100.0) < 1.0


# ── 5. TrackNetV3BallTracker Interface Compatibility ──────────────────────────

def test_tracknet_v3_ball_tracker_interface():
    """Verify TrackNetV3BallTracker implements all required tracker methods."""
    tracker = TrackNetV3BallTracker(
        model_path=None,
        enable_rectification=True,
    )

    detections = [
        {1: [100.0, 200.0, 124.0, 224.0]},
        {},
        {1: [120.0, 210.0, 144.0, 234.0]},
    ]

    # Interpolate
    interp = tracker.interpolate_ball_positions(detections, smooth_window=1)
    assert len(interp) == 3
    assert all(d.get(1) is not None for d in interp)

    # Vertical reversal detection
    reversed_dets = [
        {1: [100, 200, 120, 220]},
        {1: [100, 215, 120, 235]},
        {1: [100, 230, 120, 250]},  # peak
        {1: [100, 210, 120, 230]},
        {1: [100, 190, 120, 210]},
    ]
    shots = tracker.get_ball_shot_frames(reversed_dets, min_spacing=2, min_delta_y=5.0)
    assert isinstance(shots, list)
