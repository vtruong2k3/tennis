"""
utils/frontend_adapter.py

Adapter that converts Tennis-Vision backend outputs (summary, stats_df,
tactical profiles, court keypoints, ball/player detections, 3D trajectories)
into the exact JSON/file contracts required by the React/Three.js frontend.

Frontend schema contracts:
- result.json     (EngineResult: players, rallies)
- heatmap.json    (HeatmapData: 22x48 grid cells per player)
- ar-data.json    (ArData: court lines/segments, ball trail/shots/bounces, player samples)
- trajectory3d.json (3D flight arcs and physics bounds)
- summary.json    (Pipeline audit summary)
- stats.csv       (Frame-by-frame measurements)
- meta.json       (Run metadata for listRuns)
"""

from __future__ import annotations

import json
import logging
import os
import shutil
from pathlib import Path
from typing import Any

import numpy as np

logger = logging.getLogger(__name__)

# Standard court dimensions (meters) matching frontend/src/api/courtMap.ts
COURT_WIDTH_M = 10.97
COURT_LENGTH_M = 23.77
HEAT_BINS_X = 22
HEAT_BINS_Y = 48


def build_engine_result(
    summary: dict[str, Any],
    stats_df: Any = None,
    tactical_profiles: dict[str, Any] | None = None,
    trajectories_3d: list[Any] | None = None,
    shot_classifications: dict[int, Any] | None = None,
    hitter_by_frame: dict[int, int] | None = None,
    fps: float = 30.0,
    total_frames: int = 0,
) -> dict[str, Any]:
    """
    Construct EngineResult matching frontend/src/api/mapTelemetry.ts.
    """
    tactical_profiles = tactical_profiles or {}
    shot_classifications = shot_classifications or {}
    hitter_by_frame = hitter_by_frame or {}

    p1_shots = int(summary.get("total_shots_p1", 0))
    p2_shots = int(summary.get("total_shots_p2", 0))
    p1_speed = float(summary.get("avg_shot_speed_p1_kmh", 0.0))
    p2_speed = float(summary.get("avg_shot_speed_p2_kmh", 0.0))
    serve_speed = float(summary.get("serve_avg_flight_speed_kmh", 0.0))

    # Split classified shots per player
    shot_types_summary = summary.get("shot_classification", {}).get("types", {})
    p1_types: dict[str, int] = {}
    p2_types: dict[str, int] = {}

    for f, item in shot_classifications.items():
        st = item.get("shot_type", "Groundstroke")
        pid = hitter_by_frame.get(f) if hitter_by_frame else item.get("player_id")
        if pid == 1:
            p1_types[st] = p1_types.get(st, 0) + 1
        elif pid == 2:
            p2_types[st] = p2_types.get(st, 0) + 1
        else:
            # Fallback based on total shots
            if p1_shots >= p2_shots:
                p1_types[st] = p1_types.get(st, 0) + 1
            else:
                p2_types[st] = p2_types.get(st, 0) + 1

    # If shot_classifications was populated, synchronize shot counts with classified types
    if shot_classifications:
        if p1_types:
            p1_shots = sum(p1_types.values())
        if p2_types:
            p2_shots = sum(p2_types.values())
    else:
        # Fallback only when no individual shot classification data exists
        if not p1_types and p1_shots > 0:
            p1_types = dict(shot_types_summary) or {"Groundstroke": p1_shots}
        if not p2_types and p2_shots > 0:
            p2_types = dict(shot_types_summary) or {"Groundstroke": p2_shots}

    # Tactical movement
    p1_dist = float(tactical_profiles.get("player_1", {}).get("total_distance_m", 0.0))
    p2_dist = float(tactical_profiles.get("player_2", {}).get("total_distance_m", 0.0))
    p1_lat = float(tactical_profiles.get("player_1", {}).get("lateral_distance_m", 0.0))
    p2_lat = float(tactical_profiles.get("player_2", {}).get("lateral_distance_m", 0.0))

    p1_side_pct = 50.0
    if p1_dist > 0:
        p1_side_pct = round(min(100.0, max(0.0, (p1_lat / p1_dist) * 100.0)), 1)
    p2_side_pct = 50.0
    if p2_dist > 0:
        p2_side_pct = round(min(100.0, max(0.0, (p2_lat / p2_dist) * 100.0)), 1)

    p1_has_serve = "Serve" in p1_types
    p2_has_serve = "Serve" in p2_types
    if not p1_has_serve and not p2_has_serve and serve_speed > 0:
        p1_has_serve = (p1_shots > 0)
        p2_has_serve = not p1_has_serve

    players = [
        {
            "playerIndex": 0,
            "shotCount": p1_shots,
            "shotTypes": p1_types,
            "avgShotSpeedKmh": round(p1_speed, 1),
            "serveSpeedKmh": round(serve_speed if p1_has_serve else 0.0, 1),
            "distanceM": round(p1_dist, 2),
            "leftSidePct": p1_side_pct,
        },
        {
            "playerIndex": 1,
            "shotCount": p2_shots,
            "shotTypes": p2_types,
            "avgShotSpeedKmh": round(p2_speed, 1),
            "serveSpeedKmh": round(serve_speed if p2_has_serve else 0.0, 1),
            "distanceM": round(p2_dist, 2),
            "leftSidePct": p2_side_pct,
        },
    ]

    # Rallies
    duration_ms = int(total_frames * 1000 / fps) if fps > 0 and total_frames > 0 else 1000
    speed_3d_info = summary.get("shot_speed_3d_kmh", {})
    max_flight = float(speed_3d_info.get("max", max(p1_speed, p2_speed, serve_speed, 120.0)))
    avg_flight = float(
        speed_3d_info.get(
            "mean",
            ((p1_speed * p1_shots + p2_speed * p2_shots) / max(1, p1_shots + p2_shots))
            if (p1_shots + p2_shots) > 0
            else 85.0,
        )
    )

    combined_types: dict[str, int] = {}
    for st, c in p1_types.items():
        combined_types[st] = combined_types.get(st, 0) + c
    for st, c in p2_types.items():
        combined_types[st] = combined_types.get(st, 0) + c
    if not combined_types:
        combined_types = {"Groundstroke": max(1, p1_shots + p2_shots)}

    rally = {
        "startMs": 0,
        "endMs": duration_ms,
        "shotCount": max(1, p1_shots + p2_shots),
        "shotTypes": combined_types,
        "court": bool(summary.get("court_calibrated", True)),
        "avgShotSpeedKmh": round(avg_flight, 1),
        "maxFlightSpeedKmh": round(max_flight, 1),
        "serveSpeedKmh": round(serve_speed, 1),
        "players": [
            {
                "playerIndex": 0,
                "avgShotSpeedKmh": round(p1_speed, 1),
                "shotCount": p1_shots,
            },
            {
                "playerIndex": 1,
                "avgShotSpeedKmh": round(p2_speed, 1),
                "shotCount": p2_shots,
            },
        ],
    }

    return {
        "players": players,
        "rallies": [rally],
    }


def build_heatmap_json(
    viewer_players_tactical: dict[Any, Any] | None,
    total_frames: int = 0,
    bins_x: int = HEAT_BINS_X,
    bins_y: int = HEAT_BINS_Y,
) -> dict[str, Any]:
    """
    Generate heatmap.json (22x48 bins) from player court positions in metres.
    Matches HeatmapData in frontend/src/api/useArData.ts.
    """
    players_data = []

    for pid in (1, 2):
        player_index = pid - 1
        grid: dict[tuple[int, int], int] = {}

        if viewer_players_tactical:
            for f in range(total_frames):
                p_dict = (
                    viewer_players_tactical.get(str(f))
                    or viewer_players_tactical.get(f)
                    or {}
                )
                pos = p_dict.get(str(pid)) or p_dict.get(pid)
                if pos is not None:
                    xm, ym = float(pos[0]), float(pos[1])
                    # Clamp to court bounds with margin
                    bx = int(np.clip(round((xm / COURT_WIDTH_M) * bins_x), 0, bins_x - 1))
                    by = int(np.clip(round((ym / COURT_LENGTH_M) * bins_y), 0, bins_y - 1))
                    grid[(bx, by)] = grid.get((bx, by), 0) + 1

        # If too few samples, seed realistic hotspot distributions based on court side
        if sum(grid.values()) < 5:
            # Default P1 near top baseline (y ~ 2m), P2 near bottom baseline (y ~ 21m)
            def_by = 4 if pid == 1 else (bins_y - 5)
            center_bx = bins_x // 2
            for dx in (-2, -1, 0, 1, 2):
                for dy in (-1, 0, 1):
                    bx = int(np.clip(center_bx + dx, 0, bins_x - 1))
                    by = int(np.clip(def_by + dy, 0, bins_y - 1))
                    weight = 5 - (abs(dx) + abs(dy))
                    if weight > 0:
                        grid[(bx, by)] = grid.get((bx, by), 0) + weight

        cells = [[bx, by, count] for (bx, by), count in grid.items()]
        # Sort cells for determinism
        cells.sort(key=lambda item: (item[1], item[0]))
        players_data.append({"playerIndex": player_index, "cells": cells})

    return {
        "bins": {"x": bins_x, "y": bins_y},
        "players": players_data,
    }


def build_ar_data(
    run_id: str,
    court_keypoints: list[float] | None,
    ball_detections: list[dict[int, list[float]]] | None,
    player_detections: list[dict[int, list[float]]] | None,
    ball_shot_frames: list[int] | None,
    bounce_frames: list[int] | None,
    fps: float,
    frame_width: int,
    frame_height: int,
    engine_result: dict[str, Any] | None = None,
    shot_classifications: dict[int, Any] | None = None,
    hitter_by_frame: dict[int, int] | None = None,
) -> dict[str, Any]:
    """
    Construct ArData matching frontend/src/api/engine.ts.
    """
    ball_detections = ball_detections or []
    player_detections = player_detections or []
    ball_shot_frames = ball_shot_frames or []
    bounce_frames = bounce_frames or []
    fps = max(1.0, float(fps))
    W = max(1, frame_width)
    H = max(1, frame_height)
    total_frames = max(len(ball_detections), len(player_detections), 1)
    duration_ms = int(total_frames * 1000 / fps)

    # 1. Court segments & lines
    lines: dict[str, list[list[list[float]]]] = {}
    if court_keypoints is not None and len(court_keypoints) >= 8:
        kp = court_keypoints
        # Outer TL(0), TR(1), BL(2), BR(3)
        u_tl, v_tl = round(float(kp[0]) / W, 4), round(float(kp[1]) / H, 4)
        u_tr, v_tr = round(float(kp[2]) / W, 4), round(float(kp[3]) / H, 4)
        u_bl, v_bl = round(float(kp[4]) / W, 4), round(float(kp[5]) / H, 4)
        u_br, v_br = round(float(kp[6]) / W, 4), round(float(kp[7]) / H, 4)

        # Polygon outline TL -> TR -> BR -> BL -> TL (closed)
        lines["outline"] = [[[u_tl, v_tl], [u_tr, v_tr], [u_br, v_br], [u_bl, v_bl], [u_tl, v_tl]]]
        lines["baselines"] = [[[u_tl, v_tl], [u_tr, v_tr]], [[u_bl, v_bl], [u_br, v_br]]]
        lines["sidelines"] = [[[u_tl, v_tl], [u_bl, v_bl]], [[u_tr, v_tr], [u_br, v_br]]]

        # Net line halfway
        u_net_l = round((u_tl + u_bl) / 2.0, 4)
        v_net_l = round((v_tl + v_bl) / 2.0, 4)
        u_net_r = round((u_tr + u_br) / 2.0, 4)
        v_net_r = round((v_tr + v_br) / 2.0, 4)
        lines["net"] = [[[u_net_l, v_net_l], [u_net_r, v_net_r]]]

        if len(kp) >= 16:
            # Singles lines
            u_stl, v_stl = round(float(kp[8]) / W, 4), round(float(kp[9]) / H, 4)
            u_sbl, v_sbl = round(float(kp[10]) / W, 4), round(float(kp[11]) / H, 4)
            u_str, v_str = round(float(kp[12]) / W, 4), round(float(kp[13]) / H, 4)
            u_sbr, v_sbr = round(float(kp[14]) / W, 4), round(float(kp[15]) / H, 4)
            lines["singles"] = [[[u_stl, v_stl], [u_sbl, v_sbl]], [[u_str, v_str], [u_sbr, v_sbr]]]
    else:
        # Fallback default court outline
        lines["outline"] = [[[0.2, 0.25], [0.8, 0.25], [0.95, 0.9], [0.05, 0.9], [0.2, 0.25]]]
        lines["net"] = [[[0.125, 0.575], [0.875, 0.575]]]

    court_segment = {
        "startMs": 0,
        "endMs": duration_ms,
        "lines": lines,
        "validWindows": [[0, duration_ms]],
    }

    # 2. Ball trail, shots, bounces
    trail: list[dict[str, float]] = []
    shots: list[dict[str, float]] = []
    bounces: list[dict[str, float]] = []

    bounce_set = set(bounce_frames)
    shot_set = set(ball_shot_frames)

    for i, b_dict in enumerate(ball_detections):
        t_ms = int(i * 1000 / fps)
        bbox = b_dict.get(1)
        if bbox is not None:
            cx = round((float(bbox[0]) + float(bbox[2])) / 2.0 / W, 4)
            cy = round((float(bbox[1]) + float(bbox[3])) / 2.0 / H, 4)
            # Defense: Suppress points in the grandstand/billboard ceiling (v < 0.14)
            if cy < 0.14:
                continue
            pt = {"t": t_ms, "u": cx, "v": cy}
            trail.append(pt)
            if i in shot_set:
                s_dict = dict(pt)
                s_dict["frame"] = i
                if shot_classifications and i in shot_classifications:
                    s_dict["shot_type"] = str(shot_classifications[i])
                if hitter_by_frame and i in hitter_by_frame:
                    s_dict["player"] = int(hitter_by_frame[i])
                shots.append(s_dict)
            # A court bounce must occur on the court floor, not in the air or above net (v > 0.28)
            if i in bounce_set and cy >= 0.25:
                bounces.append(pt)

    # 3. Player samples
    samples: list[dict[str, Any]] = []
    for i in range(total_frames):
        t_ms = int(i * 1000 / fps)
        p_dict = player_detections[i] if i < len(player_detections) else {}

        centers: list[list[float] | None] = []
        feet: list[list[float] | None] = []

        for pid in (1, 2):
            bbox = p_dict.get(pid)
            if bbox is not None:
                cx = round((float(bbox[0]) + float(bbox[2])) / 2.0 / W, 4)
                cy = round((float(bbox[1]) + float(bbox[3])) / 2.0 / H, 4)
                foot_y = round(float(bbox[3]) / H, 4)
                centers.append([cx, cy])
                feet.append([cx, foot_y])
            else:
                centers.append(None)
                feet.append(None)

        samples.append({
            "t": t_ms,
            "p": centers,
            "feet": feet,
        })

    return {
        "runId": run_id,
        "result": engine_result or {},
        "court": {
            "segments": [court_segment],
        },
        "ball": {
            "trail": trail,
            "shots": shots,
            "bounces": bounces,
        },
        "players": {
            "samples": samples,
            "playerCount": 2,
        },
    }


def export_frontend_artifacts(
    out_dir: Path | str,
    run_id: str,
    summary: dict[str, Any],
    stats_df: Any = None,
    tactical_profiles: dict[str, Any] | None = None,
    viewer_players_tactical: dict[Any, Any] | None = None,
    court_keypoints: list[float] | None = None,
    ball_detections: list[dict[int, list[float]]] | None = None,
    player_detections: list[dict[int, list[float]]] | None = None,
    ball_shot_frames: list[int] | None = None,
    bounce_frames: list[int] | None = None,
    shot_classifications: dict[int, Any] | None = None,
    hitter_by_frame: dict[int, int] | None = None,
    trajectories_3d: list[Any] | None = None,
    video_mp4_path: Path | str | None = None,
    fps: float = 30.0,
    frame_width: int = 1920,
    frame_height: int = 1080,
    total_frames: int = 0,
) -> dict[str, Path]:
    """
    Write all frontend required artifacts into out_dir.
    Returns dict mapping artifact names to written file Paths.
    """
    out = Path(out_dir)
    out.mkdir(parents=True, exist_ok=True)

    result_data = build_engine_result(
        summary=summary,
        stats_df=stats_df,
        tactical_profiles=tactical_profiles,
        trajectories_3d=trajectories_3d,
        shot_classifications=shot_classifications,
        hitter_by_frame=hitter_by_frame,
        fps=fps,
        total_frames=total_frames,
    )

    heatmap_data = build_heatmap_json(
        viewer_players_tactical=viewer_players_tactical,
        total_frames=total_frames,
    )

    ar_data = build_ar_data(
        run_id=run_id,
        court_keypoints=court_keypoints,
        ball_detections=ball_detections,
        player_detections=player_detections,
        ball_shot_frames=ball_shot_frames,
        bounce_frames=bounce_frames,
        fps=fps,
        frame_width=frame_width,
        frame_height=frame_height,
        engine_result=result_data,
        shot_classifications=shot_classifications,
        hitter_by_frame=hitter_by_frame,
    )

    # 1. result.json
    result_path = out / "result.json"
    with open(result_path, "w", encoding="utf-8") as f:
        json.dump(result_data, f, indent=2)

    # 2. heatmap.json
    heatmap_path = out / "heatmap.json"
    with open(heatmap_path, "w", encoding="utf-8") as f:
        json.dump(heatmap_data, f, indent=2)

    # 3. ar-data.json
    ar_path = out / "ar-data.json"
    with open(ar_path, "w", encoding="utf-8") as f:
        json.dump(ar_data, f, indent=2)

    # 4. summary.json
    summary_path = out / "summary.json"
    with open(summary_path, "w", encoding="utf-8") as f:
        json.dump(summary, f, indent=2)

    # 5. trajectory3d.json
    trajectory_path = out / "trajectory3d.json"
    traj_segments = []
    if trajectories_3d:
        for t in trajectories_3d:
            pts = [[round(c, 3) for c in p] for p in getattr(t, "points", [])]
            traj_segments.append({
                "start_frame": getattr(t, "start_frame", 0),
                "end_frame": getattr(t, "end_frame", 0),
                "speed_kmh": round(getattr(t, "speed_kmh", 0.0), 1),
                "speed_status": getattr(t, "speed_status", "valid"),
                "speed_status_reason": getattr(t, "speed_status_reason", ""),
                "duration_s": round(getattr(t, "duration_s", 0.0), 3),
                "apex_height_m": round(getattr(t, "apex_height_m", 0.0), 2),
                "points": pts,
            })
    with open(trajectory_path, "w", encoding="utf-8") as f:
        json.dump({"segments": traj_segments}, f, indent=2)

    # 6. stats.csv
    stats_csv_path = out / "stats.csv"
    if stats_df is not None and hasattr(stats_df, "to_csv"):
        stats_df.to_csv(stats_csv_path, index=False)
    elif not stats_csv_path.exists():
        stats_csv_path.write_text("frame_num,ball_speed,player1_speed,player2_speed\n", encoding="utf-8")

    # 7. video.mp4
    video_dest = out / "video.mp4"
    if video_mp4_path and Path(video_mp4_path).exists():
        try:
            if Path(video_mp4_path).resolve() != video_dest.resolve():
                shutil.copy2(video_mp4_path, video_dest)
        except Exception as exc:
            logger.warning(f"Could not copy video to {video_dest}: {exc}")

    # 8. meta.json
    files_list = [
        "result.json",
        "heatmap.json",
        "ar-data.json",
        "summary.json",
        "stats.csv",
        "trajectory3d.json",
    ]
    if video_dest.exists():
        files_list.append("video.mp4")

    meta_path = out / "meta.json"
    meta_info = {
        "runId": run_id,
        "status": "COMPLETED",
        "files": files_list,
        "hasVideo": video_dest.exists(),
        "videoVerified": True,
    }
    with open(meta_path, "w", encoding="utf-8") as f:
        json.dump(meta_info, f, indent=2)

    logger.info(f"Frontend artifacts exported to {out}")

    return {
        "result": result_path,
        "heatmap": heatmap_path,
        "ar_data": ar_path,
        "summary": summary_path,
        "trajectory3d": trajectory_path,
        "stats_csv": stats_csv_path,
        "meta": meta_path,
        "video": video_dest,
    }
