"""
trackers/tracknet_v3
────────────────────
SOTA TrackNetV3 integration for Tennis-Vision:
- Trajectory Prediction Network (TrackNetV3) with U-Net architecture & background fusion
- Trajectory Rectification Network (InpaintNet) for occlusion recovery
- BackgroundEstimator for temporal median background extraction
- TrackNetV3BallTracker drop-in replacement engine
"""
from .background import BackgroundEstimator
from .inpaint import TrajectoryRectifier, generate_inpaint_mask
from .models import BallTrackerNet, InpaintNetModel, TrackNetV3Model
from .tracker import TrackNetV3BallTracker

__all__ = [
    "BackgroundEstimator",
    "TrajectoryRectifier",
    "generate_inpaint_mask",
    "TrackNetV3Model",
    "InpaintNetModel",
    "BallTrackerNet",
    "TrackNetV3BallTracker",
]
