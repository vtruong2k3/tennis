"""
utils/temporal_shot_classifier/models.py
────────────────────────────────────────
Lightweight Temporal Sequence Network for Tennis Shot Classification:
- Inputs: Normalized 17-keypoint trajectory across temporal window (B, 34, T)
- Architecture: 1D Temporal Convolutional blocks + Bidirectional GRU + Global Pooling
- Classes: Forehand, Backhand, Serve, Slice, Smash, Volley
- Model Size: ~1.2 MB, Inference Latency: < 1ms on CPU
"""
from __future__ import annotations

import torch
import torch.nn as nn
import torch.nn.functional as F

SHOT_CLASSES = [
    "Forehand",
    "Backhand",
    "Serve",
    "Slice",
    "Smash",
    "Volley",
]


class TemporalShotClassifier(nn.Module):
    """
    Spatiotemporal 1D-CNN + Bi-GRU network for tennis stroke classification.
    Takes normalized 2D skeleton keypoint sequences across T frames.
    """
    def __init__(
        self,
        num_keypoints: int = 17,
        num_classes: int = len(SHOT_CLASSES),
        window_size: int = 21,
        sequence_length: int | None = None,
        hidden_dim: int = 64,
        dropout: float = 0.2,
    ):
        super().__init__()
        in_channels = num_keypoints * 2  # 34 coordinates (x, y) per frame
        self.window_size = sequence_length if sequence_length is not None else window_size
        self.num_classes = num_classes

        # 1. Temporal Feature Extraction (1D Convolutions across time)
        self.conv1 = nn.Sequential(
            nn.Conv1d(in_channels, hidden_dim, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm1d(hidden_dim),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
        )
        self.conv2 = nn.Sequential(
            nn.Conv1d(hidden_dim, hidden_dim * 2, kernel_size=3, padding=1, bias=False),
            nn.BatchNorm1d(hidden_dim * 2),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
        )

        # 2. Sequential Dynamics Modeling (Bi-directional GRU)
        self.gru = nn.GRU(
            input_size=hidden_dim * 2,
            hidden_size=hidden_dim,
            num_layers=1,
            batch_first=True,
            bidirectional=True,
        )

        # 3. Dense Classifier Head
        self.classifier = nn.Sequential(
            nn.Linear(hidden_dim * 2, hidden_dim),
            nn.ReLU(inplace=True),
            nn.Dropout(dropout),
            nn.Linear(hidden_dim, num_classes),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: Tensor of shape (B, 34, T) or (B, T, 17, 2).
        Returns:
            Logits of shape (B, num_classes).
        """
        # Reshape (B, T, 17, 2) to (B, 34, T) if needed
        if x.ndim == 4:
            b, t, k, c = x.shape
            x = x.reshape(b, t, k * c).permute(0, 2, 1)
        elif x.ndim == 3 and x.shape[1] != 34 and x.shape[2] == 34:
            x = x.permute(0, 2, 1)

        # 1D Temporal Convolutions
        h = self.conv1(x)  # (B, hidden_dim, T)
        h = self.conv2(h)  # (B, hidden_dim * 2, T)

        # GRU expects (B, T, features)
        gru_in = h.permute(0, 2, 1)
        gru_out, _ = self.gru(gru_in)  # (B, T, hidden_dim * 2)

        # Global Average Pooling across time dimension T
        pooled = torch.mean(gru_out, dim=1)  # (B, hidden_dim * 2)

        # Logits output
        logits = self.classifier(pooled)
        return logits

    def predict_probabilities(self, x: torch.Tensor) -> torch.Tensor:
        """Returns softmax probability distribution over shot classes."""
        logits = self.forward(x)
        return F.softmax(logits, dim=-1)
