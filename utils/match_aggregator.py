"""
utils/match_aggregator.py
─────────────────────────
Aggregates telemetry, statistics, heatmaps, and AR data across multiple rallies
into unified match-level summary artifacts.

Outputs generated in run_dir:
- result.json     : Multi-rally shot details & player aggregate stats for web frontend.
- summary.json    : High-level match summary metrics.
- heatmap.json    : Cumulative 2D court occupancy heatmap for players 1 and 2.
- stats.csv       : Concatenated per-shot / per-frame timeline records.
- ar-data.json    : Root AR telemetry with full rally breakdown.
"""
from __future__ import annotations

import collections
import csv
import json
import logging
from pathlib import Path
from typing import Any

logger = logging.getLogger(__name__)


def aggregate_match_runs(
    run_dir: str | Path,
    rally_items: list[dict[str, Any]],
    original_video_path: str | Path | None = None,
) -> dict[str, Any]:
    """
    Merges outputs from all processed rallies into root-level run artifacts.
    """
    run_dir = Path(run_dir)
    run_dir.mkdir(parents=True, exist_ok=True)

    all_rallies: list[dict[str, Any]] = []
    player_accum: dict[int, dict[str, Any]] = {
        0: {
            "total_shots": 0,
            "shotTypes": collections.defaultdict(int),
            "speed_weighted_sum": 0.0,
            "max_serve_speed": 0.0,
            "distanceM": 0.0,
            "left_side_weighted_sum": 0.0,
        },
        1: {
            "total_shots": 0,
            "shotTypes": collections.defaultdict(int),
            "speed_weighted_sum": 0.0,
            "max_serve_speed": 0.0,
            "distanceM": 0.0,
            "left_side_weighted_sum": 0.0,
        },
    }

    # Heatmap accumulator: playerIndex -> (x, y) -> count
    heatmap_bins = {"x": 22, "y": 48}
    player_heatmap_cells: dict[int, dict[tuple[int, int], int]] = {
        0: collections.defaultdict(int),
        1: collections.defaultdict(int),
    }

    csv_rows: list[dict[str, Any]] = []
    csv_fieldnames: list[str] = []
    merged_ar_segments: list[dict[str, Any]] = []
    merged_ar_trail: list[dict[str, Any]] = []
    merged_ar_shots: list[dict[str, Any]] = []
    merged_ar_bounces: list[dict[str, Any]] = []
    merged_ar_samples: list[dict[str, Any]] = []

    for item in rally_items:
        rally_idx = item.get("rally_index", item.get("index", 1))
        r_dir = Path(item.get("rally_dir", run_dir / "rallies" / f"rally_{rally_idx:02d}"))
        start_s = float(item.get("start_time_s", item.get("start_s", 0.0)))
        end_s = float(item.get("end_time_s", item.get("end_s", 0.0)))
        abs_start_ms = int(start_s * 1000)
        abs_end_ms = int(end_s * 1000)

        result_path = r_dir / "result.json"
        if not result_path.exists():
            logger.warning(f"Rally {rally_idx} has no result.json at {result_path}")
            continue

        try:
            r_data = json.loads(result_path.read_text(encoding="utf-8"))
        except Exception as exc:
            logger.error(f"Failed to read {result_path}: {exc}")
            continue

        # 1. Rallies list aggregation
        rally_list = r_data.get("rallies", [])
        if rally_list:
            for sub_r in rally_list:
                entry = dict(sub_r)
                entry["rallyIndex"] = rally_idx
                # Adjust timestamps to original match timeline
                entry["startMs"] = abs_start_ms
                entry["endMs"] = abs_end_ms
                all_rallies.append(entry)
        else:
            # Fallback rally construct if rallies key was empty
            all_rallies.append({
                "rallyIndex": rally_idx,
                "startMs": abs_start_ms,
                "endMs": abs_end_ms,
                "shotCount": sum(p.get("shotCount", 0) for p in r_data.get("players", [])),
                "court": True,
                "avgShotSpeedKmh": 0.0,
                "maxFlightSpeedKmh": 0.0,
                "serveSpeedKmh": 0.0,
            })

        # 2. Player stats aggregation
        for p in r_data.get("players", []):
            pidx = int(p.get("playerIndex", 0))
            if pidx not in player_accum:
                player_accum[pidx] = {
                    "total_shots": 0,
                    "shotTypes": collections.defaultdict(int),
                    "speed_weighted_sum": 0.0,
                    "max_serve_speed": 0.0,
                    "distanceM": 0.0,
                    "left_side_weighted_sum": 0.0,
                }
                player_heatmap_cells[pidx] = collections.defaultdict(int)

            shot_count = int(p.get("shotCount", 0))
            shot_types = p.get("shotTypes", {})
            avg_speed = float(p.get("avgShotSpeedKmh", 0.0))
            serve_speed = float(p.get("serveSpeedKmh", 0.0))
            distance = float(p.get("distanceM", 0.0))
            left_side = float(p.get("leftSidePct", 50.0))

            player_accum[pidx]["total_shots"] += shot_count
            for stype, scount in shot_types.items():
                player_accum[pidx]["shotTypes"][stype] += int(scount)
            player_accum[pidx]["speed_weighted_sum"] += avg_speed * shot_count
            player_accum[pidx]["max_serve_speed"] = max(player_accum[pidx]["max_serve_speed"], serve_speed)
            player_accum[pidx]["distanceM"] += distance
            player_accum[pidx]["left_side_weighted_sum"] += left_side * shot_count

        # 3. Heatmap aggregation
        hm_path = r_dir / "heatmap.json"
        if hm_path.exists():
            try:
                hm_data = json.loads(hm_path.read_text(encoding="utf-8"))
                if "bins" in hm_data:
                    heatmap_bins = hm_data["bins"]
                for p_hm in hm_data.get("players", []):
                    pidx = int(p_hm.get("playerIndex", 0))
                    for cell in p_hm.get("cells", []):
                        if len(cell) >= 3:
                            cx, cy, ccount = int(cell[0]), int(cell[1]), int(cell[2])
                            player_heatmap_cells[pidx][(cx, cy)] += ccount
            except Exception as exc:
                logger.debug(f"Failed to merge heatmap from {hm_path}: {exc}")

        # 4. CSV aggregation
        csv_path = r_dir / "stats.csv"
        if csv_path.exists():
            try:
                with open(csv_path, "r", encoding="utf-8") as cf:
                    reader = csv.DictReader(cf)
                    if reader.fieldnames:
                        if not csv_fieldnames:
                            csv_fieldnames = ["rally_index", "abs_timestamp_s"] + [
                                f for f in reader.fieldnames if f not in ("rally_index", "abs_timestamp_s")
                            ]
                        for row in reader:
                            row_dict = dict(row)
                            row_dict["rally_index"] = rally_idx
                            time_s = float(row_dict.get("timestamp_s", 0.0) or 0.0)
                            row_dict["abs_timestamp_s"] = f"{start_s + time_s:.3f}"
                            csv_rows.append(row_dict)
            except Exception as exc:
                logger.debug(f"Failed to merge stats.csv from {csv_path}: {exc}")

        # 5. AR Data aggregation with match-timeline normalization
        ar_path = r_dir / "ar-data.json"
        if ar_path.exists():
            try:
                r_ar = json.loads(ar_path.read_text(encoding="utf-8"))
                for pt in r_ar.get("ball", {}).get("trail", []):
                    merged_ar_trail.append({"t": pt["t"] + abs_start_ms, "u": pt["u"], "v": pt["v"]})
                for pt in r_ar.get("ball", {}).get("shots", []):
                    merged_ar_shots.append({"t": pt["t"] + abs_start_ms, "u": pt["u"], "v": pt["v"]})
                for pt in r_ar.get("ball", {}).get("bounces", []):
                    merged_ar_bounces.append({"t": pt["t"] + abs_start_ms, "u": pt["u"], "v": pt["v"]})
                for s in r_ar.get("players", {}).get("samples", []):
                    merged_ar_samples.append({
                        "t": s["t"] + abs_start_ms,
                        "p": s.get("p", []),
                        "feet": s.get("feet", [])
                    })
                for seg in r_ar.get("court", {}).get("segments", []):
                    shifted_seg = {
                        "startMs": seg.get("startMs", 0) + abs_start_ms,
                        "endMs": seg.get("endMs", abs_end_ms - abs_start_ms) + abs_start_ms,
                        "lines": seg.get("lines", {}),
                    }
                    if "keyframes" in seg and seg["keyframes"]:
                        shifted_seg["keyframes"] = [
                            {"tMs": kf["tMs"] + abs_start_ms, "lines": kf.get("lines", {})}
                            for kf in seg["keyframes"]
                        ]
                    if "validWindows" in seg and seg["validWindows"]:
                        shifted_seg["validWindows"] = [
                            [w[0] + abs_start_ms, w[1] + abs_start_ms]
                            for w in seg["validWindows"]
                        ]
                    merged_ar_segments.append(shifted_seg)
            except Exception as exc:
                logger.debug(f"Failed to merge AR data from {ar_path}: {exc}")

    # Build final aggregated players list
    final_players: list[dict[str, Any]] = []
    for pidx in sorted(player_accum.keys()):
        acc = player_accum[pidx]
        tot_shots = acc["total_shots"]
        avg_speed = acc["speed_weighted_sum"] / max(1, tot_shots) if tot_shots > 0 else 0.0
        left_pct = acc["left_side_weighted_sum"] / max(1, tot_shots) if tot_shots > 0 else 50.0

        final_players.append({
            "playerIndex": pidx,
            "shotCount": tot_shots,
            "shotTypes": dict(acc["shotTypes"]),
            "avgShotSpeedKmh": round(avg_speed, 1),
            "serveSpeedKmh": round(acc["max_serve_speed"], 1),
            "distanceM": round(acc["distanceM"], 2),
            "leftSidePct": round(left_pct, 1),
        })

    # ── Write root result.json ──────────────────────────────────────────────
    merged_result = {
        "players": final_players,
        "rallies": all_rallies,
    }
    (run_dir / "result.json").write_text(json.dumps(merged_result, indent=2), encoding="utf-8")
    logger.info(f"Generated root result.json with {len(all_rallies)} rallies")

    # ── Write root heatmap.json ─────────────────────────────────────────────
    heatmap_output = {
        "bins": heatmap_bins,
        "players": [
            {
                "playerIndex": pidx,
                "cells": [[x, y, count] for (x, y), count in player_heatmap_cells[pidx].items()],
            }
            for pidx in sorted(player_heatmap_cells.keys())
        ],
    }
    (run_dir / "heatmap.json").write_text(json.dumps(heatmap_output, indent=2), encoding="utf-8")

    # ── Write root stats.csv ────────────────────────────────────────────────
    if csv_rows and csv_fieldnames:
        with open(run_dir / "stats.csv", "w", encoding="utf-8", newline="") as cf:
            writer = csv.DictWriter(cf, fieldnames=csv_fieldnames)
            writer.writeheader()
            writer.writerows(csv_rows)

    # ── Write root summary.json ─────────────────────────────────────────────
    p1 = final_players[0] if len(final_players) > 0 else {}
    p2 = final_players[1] if len(final_players) > 1 else {}
    summary_data = {
        "total_rallies": len(all_rallies),
        "total_shots_p1": p1.get("shotCount", 0),
        "total_shots_p2": p2.get("shotCount", 0),
        "avg_shot_speed_p1_kmh": p1.get("avgShotSpeedKmh", 0.0),
        "avg_shot_speed_p2_kmh": p2.get("avgShotSpeedKmh", 0.0),
        "serve_max_speed_kmh": max(p1.get("serveSpeedKmh", 0.0), p2.get("serveSpeedKmh", 0.0)),
        "court_calibrated": True,
        "rallies": all_rallies,
    }
    (run_dir / "summary.json").write_text(json.dumps(summary_data, indent=2), encoding="utf-8")

    # ── Write root ar-data.json ─────────────────────────────────────────────
    merged_ar_trail.sort(key=lambda x: x["t"])
    merged_ar_shots.sort(key=lambda x: x["t"])
    merged_ar_bounces.sort(key=lambda x: x["t"])
    merged_ar_samples.sort(key=lambda x: x["t"])
    merged_ar_segments.sort(key=lambda x: x["startMs"])

    ar_data_out = {
        "runId": run_dir.name,
        "result": merged_result,
        "court": {"segments": merged_ar_segments},
        "ball": {
            "trail": merged_ar_trail,
            "shots": merged_ar_shots,
            "bounces": merged_ar_bounces,
        },
        "players": {
            "samples": merged_ar_samples,
            "playerCount": len(final_players),
        },
    }
    (run_dir / "ar-data.json").write_text(json.dumps(ar_data_out, indent=2), encoding="utf-8")
    logger.info(
        f"Generated root ar-data.json: {len(merged_ar_trail)} trail points, "
        f"{len(merged_ar_shots)} shots, {len(merged_ar_segments)} court segments"
    )

    return merged_result
