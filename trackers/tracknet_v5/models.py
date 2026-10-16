"""
trackers/tracknet_v5/models.py
──────────────────────────────
Neural network architectures ported and optimized for TrackNetV5 (arXiv:2512.02789):
"TrackNetV5: Residual-Driven Spatio-Temporal Refinement and Motion Direction
Decoupling for Fast Object Tracking"

Key Components:
1. MotionDirectionDecoupling (MDD):
   Disentangles temporal dynamics into signed polarity fields (brightening vs darkening)
   with learnable sensitivity scaling, forming a 13-channel spatio-temporal representation.
2. V5EncoderDecoder:
   U-Net style multi-scale encoder-decoder backbone predicting initial heatmap drafts.
3. TSATTHead (R-STR):
   Lightweight factorized Spatio-Temporal Transformer refinement head operating on
   coarse drafts and motion priors to estimate corrective residual Δ for recovering occlusions.
4. TrackNetV5:
   Unified end-to-end architecture with stochastic context masking and coarse-to-fine refinement.
"""
from __future__ import annotations

import math
from typing import Tuple

import torch
import torch.nn as nn
import torch.nn.functional as F


def sinusoidal_encoding(length: int, dim: int, device: torch.device) -> torch.Tensor:
    """Computes standard 1-D sinusoidal positional encodings."""
    if dim <= 0:
        raise ValueError(f"dim must be positive, got {dim}")
    position = torch.arange(length, device=device, dtype=torch.float32).unsqueeze(1)
    div_term = torch.exp(torch.arange(0, dim, 2, device=device, dtype=torch.float32) * (-math.log(10000.0) / dim))
    pe = torch.zeros(length, dim, device=device, dtype=torch.float32)
    pe[:, 0::2] = torch.sin(position * div_term)
    if dim > 1:
        pe[:, 1::2] = torch.cos(position * div_term[: pe[:, 1::2].shape[1]])
    return pe


class Conv2DBlock(nn.Module):
    """Conv2D + BatchNorm2d + ReLU block with same-padding."""
    def __init__(self, in_dim: int, out_dim: int):
        super().__init__()
        self.conv = nn.Conv2d(in_dim, out_dim, kernel_size=3, padding=1, bias=False)
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


class MotionDirectionDecoupling(nn.Module):
    """
    MDD module from TrackNetV5.

    Given three consecutive RGB frames (t-1, t, t+1), MDD decomposes the grayscale
    differences into signed positive (brightening / arrival) and negative
    (darkening / departure) polarity fields:
        Δ_{t-1 -> t} = I_t - I_{t-1}
        P+ = ReLU(Δ),  P- = ReLU(-Δ)

    These are passed through a learnable attention mapping:
        k(α) = 5.0 / (0.45 * |tanh(α)| + eps)
        m(β) = 0.6 * tanh(β)
        A(x) = σ(k * (|x| - m))

    Interleaves with RGB frames to construct a 13-channel input tensor:
        [RGB(t-1), Att+(01), Att-(01), RGB(t), Att+(12), Att-(12), RGB(t+1)]
    """
    def __init__(self, eps: float = 1e-6):
        super().__init__()
        self.alpha = nn.Parameter(torch.zeros(()))
        self.beta = nn.Parameter(torch.zeros(()))
        self.eps = eps

    def attention_from_polarity(self, x: torch.Tensor) -> torch.Tensor:
        k = 5.0 / (0.45 * torch.abs(torch.tanh(self.alpha)) + self.eps)
        m = 0.6 * torch.tanh(self.beta)
        return torch.sigmoid(k * (torch.abs(x) - m))

    def forward(self, frames: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Args:
            frames: Tensor of shape (B, 3, 3, H, W) or (B, 9, H, W) in RGB.
        Returns:
            x_aug: 13-channel motion-augmented tensor of shape (B, 13, H, W).
            motion_maps: 4-channel polarity attention maps of shape (B, 4, H, W).
        """
        if frames.ndim == 4 and frames.shape[1] == 9:
            b, _, h, w = frames.shape
            frames = frames.reshape(b, 3, 3, h, w)
        elif frames.ndim != 5 or frames.shape[1] != 3 or frames.shape[2] != 3:
            raise ValueError(f"MDD expects frames [B,3,3,H,W] or [B,9,H,W], got {tuple(frames.shape)}")

        # Grayscale intensity
        gray = frames.mean(dim=2)  # (B, 3, H, W)
        diff01 = gray[:, 1] - gray[:, 0]
        diff12 = gray[:, 2] - gray[:, 1]

        maps = []
        for diff in (diff01, diff12):
            pos = F.relu(diff)
            neg = F.relu(-diff)
            att_pos = self.attention_from_polarity(pos)
            att_neg = self.attention_from_polarity(neg)
            maps.append(torch.stack([att_pos, att_neg], dim=1))

        att01, att12 = maps  # each is (B, 2, H, W)
        x_aug = torch.cat([
            frames[:, 0], att01,
            frames[:, 1], att12,
            frames[:, 2],
        ], dim=1)  # (B, 13, H, W)

        motion_maps = torch.cat([att01, att12], dim=1)  # (B, 4, H, W)
        return x_aug, motion_maps


class FactorizedSpatioTemporalBlock(nn.Module):
    """
    Decoupled Spatio-Temporal Transformer Block (inspired by TimeSformer).
    Sequentially applies Temporal Self-Attention over T frames, then Spatial
    Self-Attention over N spatial patch tokens.
    """
    def __init__(self, embed_dim: int, num_heads: int, mlp_ratio: float = 2.0, dropout: float = 0.0):
        super().__init__()
        mlp_hidden = int(embed_dim * mlp_ratio)
        self.temporal = nn.TransformerEncoderLayer(
            d_model=embed_dim,
            nhead=num_heads,
            dim_feedforward=mlp_hidden,
            dropout=dropout,
            batch_first=True,
            norm_first=True,
        )
        self.spatial = nn.TransformerEncoderLayer(
            d_model=embed_dim,
            nhead=num_heads,
            dim_feedforward=mlp_hidden,
            dropout=dropout,
            batch_first=True,
            norm_first=True,
        )

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        # x: (B, T, N, D)
        b, t, n, d = x.shape
        # Temporal attention over T for each spatial location
        temporal_in = x.permute(0, 2, 1, 3).reshape(b * n, t, d)
        temporal_out = self.temporal(temporal_in).reshape(b, n, t, d).permute(0, 2, 1, 3)
        # Spatial attention over N for each timestep
        spatial_in = temporal_out.reshape(b * t, n, d)
        spatial_out = self.spatial(spatial_in).reshape(b, t, n, d)
        return spatial_out


class TSATTHead(nn.Module):
    """
    Spatio-Temporal Transformer Attention Head for Residual Refinement (R-STR).
    Operates on (Draft + MDD motion priors) to predict corrective residual Δ.
    """
    def __init__(
        self,
        in_channels: int = 7,       # 3 draft heatmaps + 4 MDD motion maps
        out_channels: int = 3,      # 3 residual heatmaps
        patch_size: int = 16,
        embed_dim: int = 64,
        num_heads: int = 4,
        num_layers: int = 1,
        dropout: float = 0.0,
    ):
        super().__init__()
        self.in_channels = in_channels
        self.out_channels = out_channels
        self.patch_size = patch_size
        self.embed_dim = embed_dim

        patch_area = patch_size * patch_size
        self.patch_embed = nn.Linear(patch_area, embed_dim)
        self.blocks = nn.ModuleList([
            FactorizedSpatioTemporalBlock(embed_dim, num_heads, dropout=dropout)
            for _ in range(num_layers)
        ])
        self.patch_decode = nn.Linear(embed_dim, patch_area)
        self.pixel_shuffle = nn.PixelShuffle(patch_size)

    def _pad_to_patch(self, x: torch.Tensor) -> Tuple[torch.Tensor, Tuple[int, int]]:
        p = self.patch_size
        h, w = x.shape[-2:]
        pad_h = (p - h % p) % p
        pad_w = (p - w % p) % p
        if pad_h or pad_w:
            x = F.pad(x, (0, pad_w, 0, pad_h))
        return x, (pad_h, pad_w)

    def forward(self, draft: torch.Tensor) -> torch.Tensor:
        # draft: (B, C_in, H, W)
        b, c, h0, w0 = draft.shape
        x, (pad_h, pad_w) = self._pad_to_patch(draft)
        _, _, h, w = x.shape
        p = self.patch_size
        gh, gw = h // p, w // p

        # Non-overlapping patches per channel/timestep
        # (B*C, 1, H, W) -> unfold -> (B*C, p*p, gh*gw) -> transpose -> (B*C, gh*gw, p*p)
        patches = F.unfold(x.reshape(b * c, 1, h, w), kernel_size=p, stride=p).transpose(1, 2)
        tokens = self.patch_embed(patches).reshape(b, c, gh * gw, self.embed_dim)

        # Factorized Positional Encodings
        temporal_pe = sinusoidal_encoding(c, self.embed_dim, draft.device).view(1, c, 1, self.embed_dim)
        y_pe = sinusoidal_encoding(gh, self.embed_dim, draft.device)
        x_pe = sinusoidal_encoding(gw, self.embed_dim, draft.device)
        spatial_pe = (y_pe[:, None, :] + x_pe[None, :, :]).reshape(1, 1, gh * gw, self.embed_dim)
        tokens = tokens + temporal_pe + spatial_pe

        for block in self.blocks:
            tokens = block(tokens)

        # Decode tokens back to high-resolution residual map
        decoded = self.patch_decode(tokens.reshape(b * c, gh * gw, self.embed_dim))
        residual_tiles = decoded.transpose(1, 2).reshape(b * c, p * p, gh, gw)
        residual = self.pixel_shuffle(residual_tiles).reshape(b, c, h, w)

        if pad_h or pad_w:
            residual = residual[:, :, :h0, :w0]
        return residual[:, :self.out_channels]


class TrackNetV5(nn.Module):
    """
    TrackNetV5 Trajectory Prediction and Refinement Architecture.

    Pipeline:
      1. Motion Direction Decoupling (MDD): [B, 3, 3, H, W] -> [B, 13, H, W] + [B, 4, H, W]
      2. Multi-Scale U-Net Backbone: [B, 13, H, W] -> [B, 3, H, W] coarse draft heatmaps
      3. Long-range Skip Fusion & Stochastic Context Masking: [B, 7, H, W]
      4. Spatio-Temporal Transformer Refinement Head (R-STR): [B, 7, H, W] -> [B, 3, H, W] residual Δ
      5. Final Heatmap Output: Sigmoid(Draft + Δ)
    """
    def __init__(
        self,
        sequence_length: int = 3,
        base_channels: int = 64,
        stochastic_context_dropout: float = 0.1,
        patch_size: int = 16,
        embed_dim: int = 64,
        num_heads: int = 4,
        num_layers: int = 1,
    ):
        super().__init__()
        self.sequence_length = sequence_length
        self.mdd = MotionDirectionDecoupling()

        # U-Net Backbone (13 input channels -> sequence_length coarse draft logits)
        c = base_channels
        self.enc1 = Double2DConv(13, c)
        self.enc2 = Double2DConv(c, c * 2)
        self.enc3 = Triple2DConv(c * 2, c * 4)
        self.bottleneck = Triple2DConv(c * 4, c * 8)
        self.pool = nn.MaxPool2d(2, 2)

        self.dec1 = Triple2DConv(c * 8 + c * 4, c * 4)
        self.dec2 = Double2DConv(c * 4 + c * 2, c * 2)
        self.dec3 = Double2DConv(c * 2 + c, c)
        self.draft_proj = nn.Conv2d(c, sequence_length, kernel_size=1)

        # Long-range Skip Tensor & Stochastic Context Dropout
        self.context_dropout = nn.Dropout2d(stochastic_context_dropout)

        # R-STR Head (3 draft heatmaps + 4 motion attention maps = 7 channels)
        self.rstr = TSATTHead(
            in_channels=sequence_length + 4,
            out_channels=sequence_length,
            patch_size=patch_size,
            embed_dim=embed_dim,
            num_heads=num_heads,
            num_layers=num_layers,
        )

    def _prepare_frames(self, x: torch.Tensor) -> torch.Tensor:
        if x.ndim == 4 and x.shape[1] == 9:
            b, _, h, w = x.shape
            return x.reshape(b, 3, 3, h, w)
        if x.ndim == 5 and x.shape[1] == 3 and x.shape[2] == 3:
            return x
        raise ValueError(f"TrackNetV5 expects input (B, 3, 3, H, W) or (B, 9, H, W), got {tuple(x.shape)}")

    def forward_logits(self, x: torch.Tensor) -> Tuple[torch.Tensor, torch.Tensor]:
        """
        Computes forward pass and returns (final_logits, coarse_draft_logits).
        """
        frames = self._prepare_frames(x)
        x_aug, motion_maps = self.mdd(frames)

        # Backbone Encoder
        e1 = self.enc1(x_aug)
        p1 = self.pool(e1)

        e2 = self.enc2(p1)
        p2 = self.pool(e2)

        e3 = self.enc3(p2)
        p3 = self.pool(e3)

        bn = self.bottleneck(p3)

        # Backbone Decoder with Skip Connections
        u1 = torch.cat([F.interpolate(bn, scale_factor=2, mode="nearest"), e3], dim=1)
        d1 = self.dec1(u1)

        u2 = torch.cat([F.interpolate(d1, scale_factor=2, mode="nearest"), e2], dim=1)
        d2 = self.dec2(u2)

        u3 = torch.cat([F.interpolate(d2, scale_factor=2, mode="nearest"), e1], dim=1)
        d3 = self.dec3(u3)

        draft = self.draft_proj(d3)  # (B, 3, H, W)

        # Fuse Draft with MDD motion maps for R-STR
        draft_mdd = torch.cat([draft, motion_maps], dim=1)  # (B, 7, H, W)
        draft_for_rstr = self.context_dropout(draft_mdd) if self.training else draft_mdd

        # Residual correction
        residual = self.rstr(draft_for_rstr)  # (B, 3, H, W)
        final_logits = draft + residual
        return final_logits, draft

    def forward(self, x: torch.Tensor) -> torch.Tensor:
        """
        Forward pass returning probability heatmaps constrained to [0, 1].
        """
        final_logits, _ = self.forward_logits(x)
        return torch.sigmoid(final_logits)
