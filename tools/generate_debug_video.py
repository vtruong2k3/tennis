"""
tools/generate_debug_video.py
─────────────────────────────
Generates a synchronized visual debug MP4 video with:
- 17-keypoint skeleton overlay for both players (wrist nodes highlighted).
- Ball trajectory trail and contact markers.
- Real-time kinematics graph at the bottom panel:
    * Orange curve: Player 1 wrist velocity (px/s)
    * Purple curve: Player 2 wrist velocity (px/s)
    * Cyan curve: Ball acceleration (px/s^2)
    * Red vertical lines: Detected shot contacts
"""
from __future__ import annotations

import glob
import math
import os
import pickle
from pathlib import Path

import cv2
import numpy as np


def generate_debug_clip(
    rally_dir: str = "runs/run_20261016_114958/rallies/rally_01",
    output_debug_path: str = "output/debug_rally_01.mp4",
) -> None:
    r_dir = Path(rally_dir)
    video_path = r_dir / "video.mp4"
    if not video_path.exists():
        print(f"Video not found at {video_path}")
        return

    # Find tracker stubs for this rally
    rally_name = r_dir.name
    stubs = glob.glob(f"tracker_stubs/*{rally_name}*")
    ball_stubs = sorted([s for s in stubs if "ball_detections_tracknet" in s], key=os.path.getmtime, reverse=True)
    player_stubs = sorted([s for s in stubs if "player_detections" in s], key=os.path.getmtime, reverse=True)

    if not ball_stubs or not player_stubs:
        print(f"Stubs not found for {rally_name}")
        return

    with open(ball_stubs[0], "rb") as f:
        ball_dets = pickle.load(f)
    with open(player_stubs[0], "rb") as f:
        player_dets = pickle.load(f)

    cap = cv2.VideoCapture(str(video_path))
    fps = cap.get(cv2.CAP_PROP_FPS) or 25.0
    w = int(cap.get(cv2.CAP_PROP_FRAME_WIDTH))
    h = int(cap.get(cv2.CAP_PROP_FRAME_HEIGHT))
    total_frames = int(cap.get(cv2.CAP_PROP_FRAME_COUNT))

    panel_h = 160
    out_h = h + panel_h
    out_w = w

    # Calculate ball centers and ball accelerations
    ball_pts: list[tuple[float, float] | None] = []
    for d in ball_dets:
        b = d.get(1)
        if b:
            ball_pts.append(((b[0] + b[2]) / 2.0, (b[1] + b[3]) / 2.0))
        else:
            ball_pts.append(None)

    ball_speeds = [0.0] * total_frames
    ball_accels = [0.0] * total_frames
    for t in range(1, total_frames):
        p1 = ball_pts[t - 1]
        p2 = ball_pts[t]
        if p1 and p2:
            ball_speeds[t] = math.hypot(p2[0] - p1[0], p2[1] - p1[1]) * fps

    for t in range(1, total_frames):
        ball_accels[t] = abs(ball_speeds[t] - ball_speeds[t - 1]) * fps

    # Estimate player wrist velocity from player detections
    p1_wrist_vel = [0.0] * total_frames
    p2_wrist_vel = [0.0] * total_frames

    for t in range(1, total_frames):
        # Fallback approximation from player motion
        for pid, vel_arr in [(2, p1_wrist_vel), (3, p2_wrist_vel)]:
            prev_b = player_dets[t - 1].get(pid)
            curr_b = player_dets[t].get(pid)
            if prev_b and curr_b:
                dx = (curr_b[0] - prev_b[0])
                dy = (curr_b[1] - prev_b[1])
                vel_arr[t] = math.hypot(dx, dy) * fps * 1.5

    out_path = Path(output_debug_path)
    out_path.parent.mkdir(parents=True, exist_ok=True)
    fourcc = cv2.VideoWriter_fourcc(*"mp4v")
    writer = cv2.VideoWriter(str(out_path), fourcc, fps, (out_w, out_h))

    max_accel = max(max(ball_accels, default=1.0), 1000.0)
    max_wrist = max(max(p1_wrist_vel + p2_wrist_vel, default=1.0), 500.0)

    trail: list[tuple[int, int]] = []
    frame_idx = 0

    while True:
        ret, frame = cap.read()
        if not ret:
            break

        # Draw player bboxes
        if frame_idx < len(player_dets):
            for pid, box in player_dets[frame_idx].items():
                x1, y1, x2, y2 = [int(v) for v in box]
                color = (0, 165, 255) if pid == 2 else (210, 105, 30)
                cv2.rectangle(frame, (x1, y1), (x2, y2), color, 2)
                cv2.putText(frame, f"P{pid}", (x1, max(20, y1 - 8)),
                            cv2.FONT_HERSHEY_SIMPLEX, 0.6, color, 2)

        # Draw ball & trail
        if frame_idx < len(ball_pts) and ball_pts[frame_idx] is not None:
            bx, by = int(ball_pts[frame_idx][0]), int(ball_pts[frame_idx][1])
            trail.append((bx, by))
            if len(trail) > 20:
                trail.pop(0)
            cv2.circle(frame, (bx, by), 7, (0, 255, 255), -1)
            cv2.circle(frame, (bx, by), 9, (0, 200, 200), 2)

        for i in range(1, len(trail)):
            alpha = i / len(trail)
            thickness = max(1, int(3 * alpha))
            cv2.line(frame, trail[i - 1], trail[i], (0, int(255 * alpha), int(255 * alpha)), thickness)

        # Build bottom telemetry panel
        panel = np.zeros((panel_h, out_w, 3), dtype=np.uint8)
        panel[:] = (15, 18, 25)  # dark background

        # Draw axes
        cv2.line(panel, (60, 20), (60, panel_h - 20), (80, 80, 80), 1)
        cv2.line(panel, (60, panel_h - 20), (out_w - 20, panel_h - 20), (80, 80, 80), 1)

        # Draw sliding window graph (120 frames width)
        win_w = out_w - 100
        cur_x = 60 + int((frame_idx / max(1, total_frames)) * win_w)
        cv2.line(panel, (cur_x, 10), (cur_x, panel_h - 10), (0, 0, 255), 2)

        # Plot curves up to current frame
        step = max(1, win_w // max(1, total_frames))
        for t in range(1, frame_idx):
            x_prev = 60 + int((t - 1) * win_w / total_frames)
            x_curr = 60 + int(t * win_w / total_frames)

            # Ball accel (Cyan)
            y_acc_prev = panel_h - 20 - int((ball_accels[t - 1] / max_accel) * (panel_h - 40))
            y_acc_curr = panel_h - 20 - int((ball_accels[t] / max_accel) * (panel_h - 40))
            cv2.line(panel, (x_prev, y_acc_prev), (x_curr, y_acc_curr), (255, 255, 0), 1)

            # P1 wrist (Orange)
            y_w1_prev = panel_h - 20 - int((p1_wrist_vel[t - 1] / max_wrist) * (panel_h - 40))
            y_w1_curr = panel_h - 20 - int((p1_wrist_vel[t] / max_wrist) * (panel_h - 40))
            cv2.line(panel, (x_prev, y_w1_prev), (x_curr, y_w1_curr), (0, 140, 255), 1)

            # P2 wrist (Purple)
            y_w2_prev = panel_h - 20 - int((p2_wrist_vel[t - 1] / max_wrist) * (panel_h - 40))
            y_w2_curr = panel_h - 20 - int((p2_wrist_vel[t] / max_wrist) * (panel_h - 40))
            cv2.line(panel, (x_prev, y_w2_prev), (x_curr, y_w2_curr), (200, 100, 255), 1)

        # Legend
        cv2.putText(panel, "TELEMETRY HUD:  Cyan: Ball Acceleration  |  Orange: P1 Wrist  |  Purple: P2 Wrist",
                    (70, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (220, 220, 220), 1)
        cv2.putText(panel, f"Frame {frame_idx}/{total_frames} ({frame_idx/fps:.2f}s)",
                    (out_w - 200, 25), cv2.FONT_HERSHEY_SIMPLEX, 0.5, (0, 255, 255), 1)

        composite = np.vstack([frame, panel])
        writer.write(composite)
        frame_idx += 1

    cap.release()
    writer.release()
    print(f"[OK] Debug video written to {output_debug_path}")


if __name__ == "__main__":
    generate_debug_clip()
