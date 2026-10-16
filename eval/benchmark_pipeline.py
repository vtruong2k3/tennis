"""
eval/benchmark_pipeline.py
──────────────────────────
Benchmark evaluation harness comparing pipeline detections against ground-truth annotations.

Metrics computed:
- Shot Detection Recall: (Matched GT shots / Total GT shots) * 100%
- Shot Detection Precision: (Matched System shots / Total System shots) * 100%
- Shot Detection F1-Score: Harmonic mean of Precision and Recall
- Shot Classification Accuracy: (Correctly classified matched shots / Total matched shots) * 100%

Tolerance: Default +/- 5 frames (~0.2s at 25fps).
"""
from __future__ import annotations

import json
from pathlib import Path
from typing import Any

import pandas as pd


def evaluate_detections(
    gt_events: list[dict[str, Any]],
    detected_shots: list[dict[str, Any]],
    tolerance_frames: int = 5,
) -> dict[str, Any]:
    """
    Evaluates detected shots against ground truth using greedy bipartite matching.

    Args:
        gt_events: [{'frame': int, 'player_id': int, 'shot_type': str}, ...]
        detected_shots: [{'frame': int, 'player_id': int, 'shot_type': str}, ...]
        tolerance_frames: maximum frame difference to count as a match (+/- 5 frames)

    Returns:
        dict containing tp, fp, fn, recall, precision, f1, classification_acc, matches
    """
    unmatched_gt = list(range(len(gt_events)))
    unmatched_det = list(range(len(detected_shots)))

    # Compute candidate pairs within tolerance
    pairs = []
    for g_idx, g in enumerate(gt_events):
        for d_idx, d in enumerate(detected_shots):
            diff = abs(g["frame"] - d["frame"])
            if diff <= tolerance_frames:
                pairs.append((diff, g_idx, d_idx))

    # Match closest pairs first
    pairs.sort(key=lambda x: x[0])
    matched_gt = set()
    matched_det = set()
    matches = []

    for diff, g_idx, d_idx in pairs:
        if g_idx not in matched_gt and d_idx not in matched_det:
            matched_gt.add(g_idx)
            matched_det.add(d_idx)
            g = gt_events[g_idx]
            d = detected_shots[d_idx]
            type_correct = (str(g.get("shot_type", "")).lower() == str(d.get("shot_type", "")).lower())
            matches.append({
                "gt_frame": g["frame"],
                "det_frame": d["frame"],
                "frame_diff": diff,
                "gt_type": g.get("shot_type"),
                "det_type": d.get("shot_type"),
                "type_correct": type_correct,
            })

    tp = len(matches)
    fn = len(gt_events) - tp
    fp = len(detected_shots) - tp

    recall = (tp / len(gt_events)) * 100.0 if gt_events else 0.0
    precision = (tp / len(detected_shots)) * 100.0 if detected_shots else 0.0
    f1 = (2 * precision * recall) / (precision + recall) if (precision + recall) > 0 else 0.0

    type_correct_count = sum(1 for m in matches if m["type_correct"])
    classification_acc = (type_correct_count / tp) * 100.0 if tp > 0 else 0.0

    return {
        "tp": tp,
        "fp": fp,
        "fn": fn,
        "total_gt": len(gt_events),
        "total_detected": len(detected_shots),
        "recall": round(recall, 1),
        "precision": round(precision, 1),
        "f1": round(f1, 1),
        "classification_acc": round(classification_acc, 1),
        "matches": matches,
    }


def run_benchmark(
    benchmark_json_path: str = "tests/data/ground_truth_benchmarks.json",
    tolerance_frames: int = 5,
) -> None:
    p = Path(benchmark_json_path)
    if not p.exists():
        print(f"Benchmark file not found at {p}")
        return

    with open(p, encoding="utf-8") as f:
        benchmarks = json.load(f)

    print("=" * 65)
    print("      TENNIS-VISION GROUND TRUTH BENCHMARK REPORT")
    print(f"      Tolerance: +/- {tolerance_frames} frames")
    print("=" * 65)

    all_tp, all_fp, all_fn = 0, 0, 0
    all_matched_type_correct = 0

    for clip_name, data in benchmarks.items():
        gt_events = data.get("events", [])
        # Extract detected shots from rally run directory if exists
        rally_dir = Path("runs/run_20261016_114958/rallies") / clip_name
        detected_shots = []

        summary_file = rally_dir / "summary.json"
        stats_file = rally_dir / "stats.csv"

        if stats_file.exists():
            df = pd.read_csv(stats_file)
            shot_rows = (
                df[df["player_1_number_of_shots"].diff() > 0].index.tolist()
                + df[df["player_2_number_of_shots"].diff() > 0].index.tolist()
            )
            for idx in sorted(shot_rows):
                row = df.loc[idx]
                # stats.csv clamps frame_num to contact + 3
                raw_frame = max(0, int(row["frame_num"]) - 3)
                shot_type = str(row.get("player_1_shot_type", "") or row.get("player_2_shot_type", "") or "Unknown")
                detected_shots.append({
                    "frame": raw_frame,
                    "shot_type": shot_type,
                })

        metrics = evaluate_detections(gt_events, detected_shots, tolerance_frames=tolerance_frames)
        all_tp += metrics["tp"]
        all_fp += metrics["fp"]
        all_fn += metrics["fn"]
        all_matched_type_correct += sum(1 for m in metrics["matches"] if m["type_correct"])

        print(f"\nClip: {clip_name} (GT: {metrics['total_gt']} shots | Detected: {metrics['total_detected']} shots)")
        print(f"  Recall     : {metrics['recall']}% ({metrics['tp']}/{metrics['total_gt']})")
        print(f"  Precision  : {metrics['precision']}% ({metrics['tp']}/{metrics['total_detected']})")
        print(f"  F1-Score   : {metrics['f1']}%")
        print(f"  Class. Acc : {metrics['classification_acc']}%")
        for m in metrics["matches"]:
            status = "OK" if m["type_correct"] else "X"
            print(f"    - f{m['gt_frame']} -> f{m['det_frame']} (diff {m['frame_diff']}f): {m['gt_type']} vs {m['det_type']} [{status}]")

    total_gt = all_tp + all_fn
    total_det = all_tp + all_fp
    overall_recall = (all_tp / total_gt * 100.0) if total_gt > 0 else 0.0
    overall_prec = (all_tp / total_det * 100.0) if total_det > 0 else 0.0
    overall_f1 = (2 * overall_prec * overall_recall / (overall_prec + overall_recall)) if (overall_prec + overall_recall) > 0 else 0.0
    overall_acc = (all_matched_type_correct / all_tp * 100.0) if all_tp > 0 else 0.0

    print("\n" + "=" * 65)
    print("OVERALL PERFORMANCE SUMMARY:")
    print(f"  Overall Recall     : {overall_recall:.1f}% ({all_tp}/{total_gt} shots captured)")
    print(f"  Overall Precision  : {overall_prec:.1f}% ({all_tp}/{total_det} detected valid)")
    print(f"  Overall F1-Score   : {overall_f1:.1f}%")
    print(f"  Overall Class. Acc : {overall_acc:.1f}% ({all_matched_type_correct}/{all_tp} correct labels)")
    print("=" * 65)


if __name__ == "__main__":
    run_benchmark()
