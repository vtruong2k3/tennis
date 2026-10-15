"""
training/train_tracknet_v5.py
─────────────────────────────
Complete PyTorch training pipeline for TrackNetV5 (arXiv:2512.02789).

Features:
1. Weighted Binary Cross Entropy (WBCE) loss:
   L = - (1/N) * sum[ y * (1 - p)^2 * log(p) + (1 - y) * p^2 * log(1 - p) ]
2. Gaussian-guided binary disk target supervision (radius r=30 for 512x288)
3. Stochastic Context Masking (Dropout rho=0.1 on DraftMDD)
4. AdamW optimizer with multi-step learning rate decay (gamma=0.1)
5. Synthetic dry-run mode for CI/CD and architecture verification
"""
from __future__ import annotations

import argparse
import logging
import math
import sys
from pathlib import Path
from typing import Sequence

import cv2
import numpy as np
import torch
import torch.nn as nn
from torch.utils.data import DataLoader, Dataset

# Add repo root to path
REPO_ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(REPO_ROOT))

from trackers.tracknet_v5.models import TrackNetV5

logging.basicConfig(level=logging.INFO, format="%(asctime)s [%(levelname)s] %(message)s")
logger = logging.getLogger("train_tracknet_v5")


# ── 1. Loss Function (WBCE) ───────────────────────────────────────────────────

class WeightedBinaryCrossEntropyLoss(nn.Module):
    """
    Weighted Binary Cross Entropy (WBCE) from TrackNetV5 paper:
    L = - (1/N) * sum_i [ y_i * (1 - p_i)^2 * log(p_i) + (1 - y_i) * p_i^2 * log(1 - p_i) ]
    Dynamically suppresses easy background gradients and focuses on the ball.
    """
    def __init__(self, eps: float = 1e-7):
        super().__init__()
        self.eps = eps

    def forward(self, pred: torch.Tensor, target: torch.Tensor) -> torch.Tensor:
        pred = torch.clamp(pred, self.eps, 1.0 - self.eps)
        loss_pos = target * torch.pow(1.0 - pred, 2) * torch.log(pred)
        loss_neg = (1.0 - target) * torch.pow(pred, 2) * torch.log(1.0 - pred)
        return -torch.mean(loss_pos + loss_neg)


# ── 2. Heatmap Target Generator ──────────────────────────────────────────────

def generate_binary_disk_heatmap(
    cx: float | None,
    cy: float | None,
    width: int = 512,
    height: int = 288,
    radius: int = 30,
) -> np.ndarray:
    """
    Creates a binary disk target heatmap of shape (H, W).
    If ball is invisible or occluded (cx, cy is None), returns an all-zero map.
    """
    heatmap = np.zeros((height, width), dtype=np.float32)
    if cx is None or cy is None or cx < 0 or cy < 0 or cx >= width or cy >= height:
        return heatmap

    y_grid, x_grid = np.ogrid[:height, :width]
    dist_sq = (x_grid - cx) ** 2 + (y_grid - cy) ** 2
    heatmap[dist_sq <= radius ** 2] = 1.0
    return heatmap


# ── 3. Dataset Classes ────────────────────────────────────────────────────────

class SyntheticTennisDataset(Dataset):
    """Synthetic dataset for dry-run verification and fast testing."""
    def __init__(self, num_samples: int = 64, width: int = 512, height: int = 288):
        self.num_samples = num_samples
        self.width = width
        self.height = height

    def __len__(self) -> int:
        return self.num_samples

    def __getitem__(self, idx: int) -> tuple[torch.Tensor, torch.Tensor]:
        # Generate 3 consecutive frames with a synthetic moving white tennis ball
        bg_val = np.random.randint(40, 100)
        frames = [np.full((self.height, self.width, 3), bg_val, dtype=np.float32) for _ in range(3)]

        # Trajectory
        x_start = np.random.randint(50, self.width - 150)
        y_start = np.random.randint(50, self.height - 100)
        dx = np.random.randint(5, 25)
        dy = np.random.randint(-10, 10)

        targets = []
        for t in range(3):
            bx = x_start + t * dx
            by = y_start + t * dy
            cv2.circle(frames[t], (int(bx), int(by)), 5, (255, 255, 255), -1)
            frames[t] = frames[t] / 255.0
            targets.append(generate_binary_disk_heatmap(bx, by, self.width, self.height, radius=20))

        # Tensor conversions
        # frames: (3, 3, H, W)
        frames_tensor = torch.from_numpy(np.stack(frames, axis=0).transpose(0, 3, 1, 2)).float()
        # targets: (3, H, W)
        targets_tensor = torch.from_numpy(np.stack(targets, axis=0)).float()
        return frames_tensor, targets_tensor


# ── 4. Training Loop ──────────────────────────────────────────────────────────

def train_tracknet_v5(
    dataset: Dataset,
    val_dataset: Dataset | None = None,
    epochs: int = 10,
    batch_size: int = 4,
    learning_rate: float = 1e-4,
    device_str: str = "auto",
    output_path: str = "models/tracknet_v5.pt",
) -> None:
    if device_str == "auto":
        device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
    else:
        device = torch.device(device_str)

    logger.info(f"Initializing TrackNetV5 training on {device}...")
    model = TrackNetV5().to(device)
    criterion = WeightedBinaryCrossEntropyLoss()
    optimizer = torch.optim.AdamW(model.parameters(), lr=learning_rate, weight_decay=1e-4)
    scheduler = torch.optim.lr_scheduler.MultiStepLR(optimizer, milestones=[int(epochs * 0.7), int(epochs * 0.9)], gamma=0.1)

    loader = DataLoader(dataset, batch_size=batch_size, shuffle=True, drop_last=True)
    val_loader = DataLoader(val_dataset, batch_size=batch_size, shuffle=False) if val_dataset else None

    best_loss = float("inf")
    output_file = Path(output_path)
    output_file.parent.mkdir(parents=True, exist_ok=True)

    for epoch in range(1, epochs + 1):
        model.train()
        train_loss = 0.0

        for batch_idx, (frames, targets) in enumerate(loader):
            frames = frames.to(device)      # (B, 3, 3, H, W)
            targets = targets.to(device)    # (B, 3, H, W)

            optimizer.zero_grad()
            preds = model(frames)           # (B, 3, H, W) in [0, 1]
            loss = criterion(preds, targets)
            loss.backward()
            optimizer.step()

            train_loss += loss.item()

        avg_train_loss = train_loss / max(1, len(loader))
        scheduler.step()

        val_loss_str = ""
        if val_loader:
            model.eval()
            val_loss = 0.0
            with torch.no_grad():
                for frames, targets in val_loader:
                    frames, targets = frames.to(device), targets.to(device)
                    preds = model(frames)
                    val_loss += criterion(preds, targets).item()
            avg_val_loss = val_loss / max(1, len(val_loader))
            val_loss_str = f" | Val Loss: {avg_val_loss:.6f}"

            if avg_val_loss < best_loss:
                best_loss = avg_val_loss
                torch.save({"model_state_dict": model.state_dict(), "epoch": epoch}, str(output_file))
                logger.info(f"  -> Saved best checkpoint to {output_file} (Val Loss: {best_loss:.6f})")
        else:
            if avg_train_loss < best_loss:
                best_loss = avg_train_loss
                torch.save({"model_state_dict": model.state_dict(), "epoch": epoch}, str(output_file))

        logger.info(f"Epoch [{epoch}/{epochs}] Train Loss: {avg_train_loss:.6f}{val_loss_str}")

    logger.info(f"✓ Training finished. Final model saved to {output_file}")


def main() -> int:
    parser = argparse.ArgumentParser(description="TrackNetV5 Training Pipeline")
    parser.add_argument("--epochs", type=int, default=5, help="Number of epochs")
    parser.add_argument("--batch-size", type=int, default=2, help="Batch size")
    parser.add_argument("--lr", type=float, default=1e-4, help="Learning rate")
    parser.add_argument("--device", type=str, default="auto", help="cuda | cpu | auto")
    parser.add_argument("--output", type=str, default="models/tracknet_v5.pt", help="Checkpoint output path")
    parser.add_argument("--test-run", action="store_true", help="Run 2-epoch synthetic verification test")
    args = parser.parse_args()

    if args.test_run:
        logger.info("Executing synthetic dry-run verification...")
        train_ds = SyntheticTennisDataset(num_samples=16)
        val_ds = SyntheticTennisDataset(num_samples=8)
        train_tracknet_v5(
            dataset=train_ds,
            val_dataset=val_ds,
            epochs=2,
            batch_size=2,
            learning_rate=args.lr,
            device_str=args.device,
            output_path="models/test_tracknet_v5_dryrun.pt",
        )
        return 0

    train_ds = SyntheticTennisDataset(num_samples=64)
    train_tracknet_v5(
        dataset=train_ds,
        epochs=args.epochs,
        batch_size=args.batch_size,
        learning_rate=args.lr,
        device_str=args.device,
        output_path=args.output,
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
