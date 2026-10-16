"""
tests/test_tracknet_v5_integration.py
─────────────────────────────────────
Comprehensive test suite for TrackNetV5:
- Motion Direction Decoupling (MDD) polarity verification
- Spatio-temporal Transformer refinement (R-STR)
- TrackNetV5BallTracker drop-in replacement interface
- Largest Connected Component (LCC) centroid extraction
- Weighted Binary Cross Entropy (WBCE) loss formulation
"""
from __future__ import annotations

import os
import sys

import cv2
import numpy as np
import pytest
import torch

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from trackers.tracknet_v5 import (
    FactorizedSpatioTemporalBlock,
    MotionDirectionDecoupling,
    TrackNetV5,
    TrackNetV5BallTracker,
    TSATTHead,
)
from training.train_tracknet_v5 import WeightedBinaryCrossEntropyLoss, generate_binary_disk_heatmap


# ── 1. Model Forward Passes & Shape Contracts ─────────────────────────────────

def test_tracknet_v5_model_forward():
    """Verify TrackNetV5 forward pass produces expected heatmap shape [B, 3, H, W]."""
    model = TrackNetV5(base_channels=32)
    model.eval()

    # Synthetic batch of 2, 3 frames x 3 RGB channels = 9 channels, 144x256
    dummy_input = torch.randn(2, 9, 144, 256)
    with torch.no_grad():
        out = model(dummy_input)

    assert out.shape == (2, 3, 144, 256)
    assert (out >= 0.0).all() and (out <= 1.0).all(), "Sigmoid outputs must lie in [0, 1]"


def test_tracknet_v5_5d_tensor_forward():
    """Verify TrackNetV5 accepts explicit 5-D tensor [B, 3, 3, H, W]."""
    model = TrackNetV5(base_channels=32)
    model.eval()

    dummy_input = torch.randn(1, 3, 3, 144, 256)
    with torch.no_grad():
        out = model(dummy_input)

    assert out.shape == (1, 3, 144, 256)


# ── 2. Motion Direction Decoupling (MDD) Polarity Verification ─────────────────

def test_mdd_polarity_decomposition():
    """
    Ensure MDD explicitly separates positive (brightening / arrival) and
    negative (darkening / departure) motion polarity.
    """
    mdd = MotionDirectionDecoupling()
    mdd.eval()

    # Create 3 frames: frame 0 has dark spot, frame 1 has bright spot, frame 2 returns dark
    f0 = np.full((72, 128, 3), 50, dtype=np.float32)
    f1 = np.full((72, 128, 3), 50, dtype=np.float32)
    f2 = np.full((72, 128, 3), 50, dtype=np.float32)

    # Ball arrives at (30, 40) at frame 1
    f1[28:32, 38:42, :] = 250

    frames = np.stack([f0, f1, f2], axis=0).transpose(0, 3, 1, 2)  # [3, 3, H, W]
    frames_tensor = torch.from_numpy(frames).unsqueeze(0).float() / 255.0

    with torch.no_grad():
        x_aug, motion_maps = mdd(frames_tensor)

    # 13-channel augmented input + 4-channel polarity attention maps
    assert x_aug.shape == (1, 13, 72, 128)
    assert motion_maps.shape == (1, 4, 72, 128)

    # motion_maps: [Att+(01), Att-(01), Att+(12), Att-(12)]
    att_pos_01 = motion_maps[0, 0].numpy()
    att_neg_01 = motion_maps[0, 1].numpy()

    # The region where ball appeared should have high positive polarity
    ball_region_pos = att_pos_01[28:32, 38:42].mean()
    ball_region_neg = att_neg_01[28:32, 38:42].mean()
    assert ball_region_pos > ball_region_neg, "Arrival of bright ball must activate positive polarity"


# ── 3. TSATTHead Residual Computation ──────────────────────────────────────────

def test_tsatt_residual_head():
    """Verify TSATTHead generates factorized spatial-temporal residual Δ."""
    rstr = TSATTHead(in_channels=7, out_channels=3, patch_size=16, embed_dim=32, num_heads=2)
    rstr.eval()

    draft_mdd = torch.randn(2, 7, 64, 64)
    with torch.no_grad():
        residual = rstr(draft_mdd)

    assert residual.shape == (2, 3, 64, 64)


# ── 4. LCC Centroid Extraction & Tracker Interface ─────────────────────────────

def test_tracknet_v5_lcc_centroid_ignores_secondary_blob():
    """
    Ensure the Largest Connected Component algorithm picks the primary ball
    and ignores smaller noise/shoe/marking blobs.
    """
    tracker = TrackNetV5BallTracker()

    # Create synthetic heatmap with 2 blobs: primary ball (area 40) and small noise (area 8)
    heatmap = np.zeros((tracker.INPUT_HEIGHT, tracker.INPUT_WIDTH), dtype=np.float32)
    # Primary blob at (200, 100)
    cv2.circle(heatmap, (200, 100), 4, 0.9, -1)
    # Secondary smaller blob at (50, 50)
    cv2.circle(heatmap, (50, 50), 1, 0.8, -1)

    bbox = tracker._output_to_bbox(heatmap, orig_h=720, orig_w=1280)
    assert bbox is not None

    cx = (bbox[0] + bbox[2]) / 2.0
    cy = (bbox[1] + bbox[3]) / 2.0

    # Scale factor from 512x288 to 1280x720:
    expected_cx = 200 * (1280 / tracker.INPUT_WIDTH)
    expected_cy = 100 * (720 / tracker.INPUT_HEIGHT)

    assert abs(cx - expected_cx) <= 5.0
    assert abs(cy - expected_cy) <= 5.0


def test_tracknet_v5_tracker_interface():
    """Verify TrackNetV5BallTracker implements all required tracker methods."""
    tracker = TrackNetV5BallTracker()

    detections = [
        {1: [100.0, 200.0, 124.0, 224.0]},
        {},
        {1: [120.0, 210.0, 144.0, 234.0]},
    ]

    # Interpolate
    interpolated = tracker.interpolate_ball_positions(detections)
    assert len(interpolated) == 3
    assert 1 in interpolated[1]
    assert 100.0 < interpolated[1][1][0] < 120.0

    # Draw boxes
    fake_frames = [np.zeros((720, 1280, 3), dtype=np.uint8) for _ in range(3)]
    drawn = tracker.draw_bboxes(fake_frames, interpolated)
    assert len(drawn) == 3


# ── 5. Loss Function Contract ─────────────────────────────────────────────────

def test_wbce_loss():
    """Verify Weighted Binary Cross Entropy computes finite, valid loss."""
    wbce = WeightedBinaryCrossEntropyLoss()
    pred = torch.tensor([[[0.9, 0.1], [0.2, 0.8]]], dtype=torch.float32)
    target = torch.tensor([[[1.0, 0.0], [0.0, 1.0]]], dtype=torch.float32)

    loss = wbce(pred, target)
    assert torch.isfinite(loss)
    assert loss.item() >= 0.0
