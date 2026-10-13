"""
trackers/tracknet_v3/models.py
──────────────────────────────
Neural network architectures ported and optimized from TrackNetV3 (ACM MM 2023):
1. TrackNetV3Model: U-Net style spatio-temporal encoder-decoder with skip connections
   for tiny, high-speed ball detection with auxiliary background input.
2. InpaintNetModel: 1D Temporal Convolutional Neural Network for trajectory
   rectification across occlusion gaps.
3. BallTrackerNet: TrackNet v2 backward-compatibility architecture.
"""
from __future__ import annotations

import torch
import torch.nn as nn


# ── TrackNetV3 2D Conv Blocks ────────────────────────────────────────────────

class Conv2DBlock(nn.Module):
    """Conv2D + BatchNorm2d + ReLU block with same-padding."""
    def __init__(self, in_dim: int, out_dim: int):
        super().__init__()
        self.conv = nn.Conv2d(in_dim, out_dim, kernel_size=3, padding="same", bias=False)
        self.bn = nn.BatchNorm2d(out_dim)
        self.relu = nn.ReLU(inplace=True)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.relu(self.bn(self.conv(x)))


class Double2DConv(nn.Module):
    """Two consecutive Conv2DBlocks."""
    def __init__(self, in_dim: int, out_dim: int):
        super().__init__()
        self.conv_1 = Conv2DBlock(in_dim, out_dim)
        self.conv_2 = Conv2DBlock(out_dim, out_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.conv_2(self.conv_1(x))


class Triple2DConv(nn.Module):
    """Three consecutive Conv2DBlocks."""
    def __init__(self, in_dim: int, out_dim: int):
        super().__init__()
        self.conv_1 = Conv2DBlock(in_dim, out_dim)
        self.conv_2 = Conv2DBlock(out_dim, out_dim)
        self.conv_3 = Conv2DBlock(out_dim, out_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.conv_3(self.conv_2(self.conv_1(x)))


class TrackNetV3Model(nn.Module):
    """
    TrackNetV3 Trajectory Prediction Network.

    Encoder-decoder network with skip connections that maps stacked consecutive
    frames (optionally with median background channels) to probability heatmaps.
    """
    def __init__(self, in_dim: int = 9, out_dim: int = 3):
        super().__init__()
        self.in_dim = in_dim
        self.out_dim = out_dim

        self.down_block_1 = Double2DConv(in_dim, 64)
        self.down_block_2 = Double2DConv(64, 128)
        self.down_block_3 = Triple2DConv(128, 256)
        self.bottleneck   = Triple2DConv(256, 512)

        self.up_block_1   = Triple2DConv(768, 256)
        self.up_block_2   = Double2DConv(384, 128)
        self.up_block_3   = Double2DConv(192, 64)

        self.predictor    = nn.Conv2d(64, out_dim, kernel_size=(1, 1))
        self.sigmoid      = nn.Sigmoid()
        self.pool         = nn.MaxPool2d((2, 2), stride=(2, 2))
        self.upsample     = nn.Upsample(scale_factor=2, mode="nearest")

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # Encoder with skip features
        x1 = self.down_block_1(x)
        p1 = self.pool(x1)

        x2 = self.down_block_2(p1)
        p2 = self.pool(x2)

        x3 = self.down_block_3(p2)
        p3 = self.pool(x3)

        bn = self.bottleneck(p3)

        # Decoder with skip concatenations
        u1 = torch.cat([self.upsample(bn), x3], dim=1)
        x_up1 = self.up_block_1(u1)

        u2 = torch.cat([self.upsample(x_up1), x2], dim=1)
        x_up2 = self.up_block_2(u2)

        u3 = torch.cat([self.upsample(x_up2), x1], dim=1)
        x_up3 = self.up_block_3(u3)

        out = self.predictor(x_up3)
        return self.sigmoid(out)


# ── InpaintNet 1D Temporal Conv Blocks ────────────────────────────────────────

class Conv1DBlock(nn.Module):
    """Conv1D + LeakyReLU block with same-padding."""
    def __init__(self, in_dim: int, out_dim: int):
        super().__init__()
        self.conv = nn.Conv1d(in_dim, out_dim, kernel_size=3, padding="same", bias=True)
        self.relu = nn.LeakyReLU(0.1, inplace=True)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.relu(self.conv(x))


class Double1DConv(nn.Module):
    """Two consecutive Conv1DBlocks."""
    def __init__(self, in_dim: int, out_dim: int):
        super().__init__()
        self.conv_1 = Conv1DBlock(in_dim, out_dim)
        self.conv_2 = Conv1DBlock(out_dim, out_dim)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.conv_2(self.conv_1(x))


class InpaintNetModel(nn.Module):
    """
    InpaintNet Trajectory Rectification Network.

    Takes normalized 2D coordinates (x, y) across a temporal window L along with
    a binary inpaint mask (1 = missing/occluded, 0 = visible), and outputs
    inpainted (x, y) coordinates for the occluded frames.
    """
    def __init__(self, in_dim: int = 3, out_dim: int = 2):
        super().__init__()
        self.down_1     = Conv1DBlock(in_dim, 32)
        self.down_2     = Conv1DBlock(32, 64)
        self.down_3     = Conv1DBlock(64, 128)
        self.bottleneck = Double1DConv(128, 256)

        self.up_1       = Conv1DBlock(384, 128)
        self.up_2       = Conv1DBlock(192, 64)
        self.up_3       = Conv1DBlock(96, 32)

        self.predictor  = nn.Conv1d(32, out_dim, kernel_size=3, padding="same")
        self.sigmoid    = nn.Sigmoid()

    def forward(self, x: torch.Tensor, mask: torch.Tensor) -> torch.Tensor:
        """
        Args:
            x: Tensor of shape (B, L, 2) normalized to [0, 1]
            mask: Tensor of shape (B, L, 1) where 1 indicates occluded/missing

        Returns:
            Tensor of shape (B, L, 2) representing rectified coordinates.
        """
        # Concatenate coordinates and occlusion mask along feature dimension
        feat = torch.cat([x, mask], dim=2)                  # (B, L, 3)
        feat = feat.permute(0, 2, 1)                        # (B, 3, L)

        x1 = self.down_1(feat)                              # (B, 32, L)
        x2 = self.down_2(x1)                                # (B, 64, L)
        x3 = self.down_3(x2)                                # (B, 128, L)
        bn = self.bottleneck(x3)                            # (B, 256, L)

        u1 = torch.cat([bn, x3], dim=1)                     # (B, 384, L)
        x_up1 = self.up_1(u1)                               # (B, 128, L)

        u2 = torch.cat([x_up1, x2], dim=1)                  # (B, 192, L)
        x_up2 = self.up_2(u2)                               # (B, 64, L)

        u3 = torch.cat([x_up2, x1], dim=1)                  # (B, 96, L)
        x_up3 = self.up_3(u3)                               # (B, 32, L)

        out = self.predictor(x_up3)                         # (B, 2, L)
        out = self.sigmoid(out)
        return out.permute(0, 2, 1)                         # (B, L, 2)


# ── TrackNet v2 Backward Compatibility Architecture ──────────────────────────

class ConvBlockV2(nn.Module):
    def __init__(self, in_channels: int, out_channels: int):
        super().__init__()
        self.block = nn.Sequential(
            nn.Conv2d(in_channels, out_channels, kernel_size=3, padding=1, bias=True),
            nn.ReLU(inplace=True),
            nn.BatchNorm2d(out_channels),
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        return self.block(x)


class BallTrackerNet(nn.Module):
    """TrackNet v2 VGG-style encoder-decoder (256-channel argmax output)."""
    def __init__(self, out_channels: int = 256):
        super().__init__()
        self.out_channels = out_channels

        self.conv1  = ConvBlockV2(9,   64)
        self.conv2  = ConvBlockV2(64,  64)
        self.pool1  = nn.MaxPool2d(kernel_size=2, stride=2)
        self.conv3  = ConvBlockV2(64,  128)
        self.conv4  = ConvBlockV2(128, 128)
        self.pool2  = nn.MaxPool2d(kernel_size=2, stride=2)
        self.conv5  = ConvBlockV2(128, 256)
        self.conv6  = ConvBlockV2(256, 256)
        self.conv7  = ConvBlockV2(256, 256)
        self.pool3  = nn.MaxPool2d(kernel_size=2, stride=2)
        self.conv8  = ConvBlockV2(256, 512)
        self.conv9  = ConvBlockV2(512, 512)
        self.conv10 = ConvBlockV2(512, 512)
        self.ups1   = nn.Upsample(scale_factor=2)
        self.conv11 = ConvBlockV2(512, 256)
        self.conv12 = ConvBlockV2(256, 256)
        self.conv13 = ConvBlockV2(256, 256)
        self.ups2   = nn.Upsample(scale_factor=2)
        self.conv14 = ConvBlockV2(256, 128)
        self.conv15 = ConvBlockV2(128, 128)
        self.ups3   = nn.Upsample(scale_factor=2)
        self.conv16 = ConvBlockV2(128, 64)
        self.conv17 = ConvBlockV2(64,  64)
        self.conv18 = ConvBlockV2(64,  out_channels)

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        b = x.size(0)
        x = self.conv2(self.conv1(x))
        x = self.conv4(self.conv3(self.pool1(x)))
        x = self.conv7(self.conv6(self.conv5(self.pool2(x))))
        x = self.conv10(self.conv9(self.conv8(self.pool3(x))))
        x = self.conv13(self.conv12(self.conv11(self.ups1(x))))
        x = self.conv15(self.conv14(self.ups2(x)))
        x = self.conv18(self.conv17(self.conv16(self.ups3(x))))
        return x.reshape(b, self.out_channels, -1)
