"""
Tests for Temporal Shot Classifier (Option A: YOLO11-Pose + 21-frame Temporal Sequence).
"""
import os
import numpy as np
import pytest
import torch

from utils.temporal_shot_classifier.models import TemporalShotClassifier
from utils.temporal_shot_classifier.pose_extractor import YoloPoseExtractor
from utils.temporal_shot_classifier.classifier import TemporalShotClassifierEngine


def test_temporal_shot_classifier_model_shapes():
    """Verify forward pass and shapes of TemporalShotClassifier model."""
    model = TemporalShotClassifier(num_classes=6, sequence_length=21)
    batch_size = 4
    dummy_input = torch.randn(batch_size, 34, 21)
    output = model(dummy_input)
    assert output.shape == (batch_size, 6), f"Expected shape ({batch_size}, 6), got {output.shape}"
    # Verify probability distribution (softmax sum to ~1.0)
    probs = torch.softmax(output, dim=1)
    sums = probs.sum(dim=1)
    assert torch.allclose(sums, torch.ones_like(sums), atol=1e-5)


def test_pose_normalization():
    """Verify root-relative and scale-invariant normalization."""
    extractor = YoloPoseExtractor()
    seq_len = 21
    # 17 keypoints: [x, y, conf]
    raw_kpts = np.zeros((seq_len, 17, 3), dtype=np.float32)

    # Set hips (11, 12) at y=200, shoulders (5, 6) at y=100
    for t in range(seq_len):
        raw_kpts[t, 11] = [90.0, 200.0, 0.9]
        raw_kpts[t, 12] = [110.0, 200.0, 0.9]
        raw_kpts[t, 5] = [85.0, 100.0, 0.9]
        raw_kpts[t, 6] = [115.0, 100.0, 0.9]
        raw_kpts[t, 10] = [120.0 + t, 150.0, 0.9]  # Moving right wrist

    normalized = extractor.normalize_keypoints(raw_kpts)
    assert isinstance(normalized, torch.Tensor)
    assert normalized.shape == (1, 34, seq_len)

    # Hip midpoint was at (100, 200). Root-relative hip mid should be 0.
    # Torso length is ||(100, 100) - (100, 200)|| = 100 px.
    # Shoulder neck should be normalized to around y = -1.0.
    # Joint 5 (L shoulder) y: normalized[0, 5*2 + 1, 0]
    l_shoulder_y = normalized[0, 5 * 2 + 1, 0].item()
    assert -1.5 < l_shoulder_y < -0.5, f"Expected shoulder y near -1.0, got {l_shoulder_y}"


def test_classifier_engine_edge_padding_and_classification():
    """Verify that TemporalShotClassifierEngine handles boundary frames (t=2, t=N-2) with edge padding."""
    engine = TemporalShotClassifierEngine()
    total_frames = 30
    fake_frames = [np.full((720, 1280, 3), 100, dtype=np.uint8) for _ in range(total_frames)]
    fake_player_dets = [{1: [300, 200, 420, 500]} for _ in range(total_frames)]

    # Test edge boundary t=2 (requires left padding of 8 frames)
    shot_type_start, conf_start = engine.classify_shot(
        video_frames=fake_frames,
        shot_frame=2,
        player_detections=fake_player_dets,
        player_id=1,
        is_serve=False,
    )
    assert shot_type_start in engine.CLASSES
    assert 0.0 <= conf_start <= 1.0

    # Test edge boundary t=28 (requires right padding of 8 frames)
    shot_type_end, conf_end = engine.classify_shot(
        video_frames=fake_frames,
        shot_frame=28,
        player_detections=fake_player_dets,
        player_id=1,
        is_serve=False,
    )
    assert shot_type_end in engine.CLASSES
    assert 0.0 <= conf_end <= 1.0


def test_classifier_engine_with_ball_kinematics():
    """Verify fusion with ball detections."""
    engine = TemporalShotClassifierEngine()
    total_frames = 25
    fake_frames = [np.full((720, 1280, 3), 128, dtype=np.uint8) for _ in range(total_frames)]
    fake_player_dets = [{1: [300, 200, 450, 550]} for _ in range(total_frames)]

    # Ball moving towards player, hitting at t=12, moving away
    fake_ball_dets = {}
    for t in range(total_frames):
        fake_ball_dets[t] = {1: [350 + t * 5, 250 + (t - 12) ** 2, 360 + t * 5, 260 + (t - 12) ** 2]}

    shot_type, conf = engine.classify_shot(
        video_frames=fake_frames,
        shot_frame=12,
        player_detections=fake_player_dets,
        player_id=1,
        ball_detections=fake_ball_dets,
        is_serve=False,
    )
    assert shot_type in engine.CLASSES
    assert 0.0 <= conf <= 1.0


def test_non_opening_shot_cannot_be_serve():
    """Verify tennis grammar invariant: shots after the opening shot are never Serve."""
    engine = TemporalShotClassifierEngine()
    total_frames = 25
    fake_frames = [np.full((720, 1280, 3), 128, dtype=np.uint8) for _ in range(total_frames)]
    # Player at baseline
    fake_player_dets = [{1: [300, 450, 450, 680]} for _ in range(total_frames)]

    shot_type, conf = engine.classify_shot(
        video_frames=fake_frames,
        shot_frame=12,
        player_detections=fake_player_dets,
        player_id=1,
        is_serve=False,
        is_first_shot=False,
    )
    assert shot_type != "Serve"

