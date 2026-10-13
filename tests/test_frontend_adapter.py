import json
from pathlib import Path
from utils.frontend_adapter import (
    build_engine_result,
    build_heatmap_json,
    build_ar_data,
    export_frontend_artifacts,
)


def test_build_engine_result():
    summary = {
        "total_shots_p1": 2,
        "total_shots_p2": 3,
        "avg_shot_speed_p1_kmh": 110.0,
        "avg_shot_speed_p2_kmh": 125.0,
        "serve_avg_flight_speed_kmh": 140.0,
        "court_calibrated": True,
        "shot_classification": {"types": {"Serve": 1, "Forehand": 4}},
    }
    tactical_profiles = {
        "player_1": {"total_distance_m": 12.5, "lateral_distance_m": 6.0},
        "player_2": {"total_distance_m": 15.0, "lateral_distance_m": 8.0},
    }

    res = build_engine_result(summary, tactical_profiles=tactical_profiles, fps=30.0, total_frames=120)
    assert "players" in res
    assert "rallies" in res
    assert len(res["players"]) == 2
    assert res["players"][0]["shotCount"] == 2
    assert res["players"][1]["shotCount"] == 3
    assert res["players"][0]["distanceM"] == 12.5
    assert len(res["rallies"]) == 1
    assert res["rallies"][0]["startMs"] == 0
    assert res["rallies"][0]["endMs"] == 4000
    assert res["rallies"][0]["court"] is True


def test_build_heatmap_json():
    viewer_players = {
        "0": {"1": (5.48, 2.0), "2": (5.48, 21.0)},
        "1": {"1": (5.50, 2.2), "2": (5.50, 21.2)},
    }
    hm = build_heatmap_json(viewer_players, total_frames=2)
    assert "bins" in hm
    assert hm["bins"]["x"] == 22
    assert hm["bins"]["y"] == 48
    assert len(hm["players"]) == 2
    for p in hm["players"]:
        assert "playerIndex" in p
        assert len(p["cells"]) > 0
        for cell in p["cells"]:
            assert len(cell) == 3
            bx, by, count = cell
            assert 0 <= bx < 22
            assert 0 <= by < 48
            assert count > 0


def test_build_ar_data():
    court_kp = [
        100.0, 100.0,   # TL
        900.0, 100.0,   # TR
        100.0, 900.0,   # BL
        900.0, 900.0,   # BR
    ] + [500.0] * 20
    ball_det = [{1: [490, 490, 510, 510]}]
    player_det = [{1: [100, 200, 150, 300], 2: [800, 700, 850, 800]}]

    ar = build_ar_data(
        run_id="run_test",
        court_keypoints=court_kp,
        ball_detections=ball_det,
        player_detections=player_det,
        ball_shot_frames=[0],
        bounce_frames=[],
        fps=30.0,
        frame_width=1000,
        frame_height=1000,
    )

    assert ar["runId"] == "run_test"
    assert "court" in ar
    assert "segments" in ar["court"]
    outline = ar["court"]["segments"][0]["lines"]["outline"][0]
    assert len(outline) == 5  # closed polygon
    assert len(ar["ball"]["trail"]) == 1
    assert ar["ball"]["trail"][0]["u"] == 0.5
    assert len(ar["players"]["samples"]) == 1
    p_samples = ar["players"]["samples"][0]
    assert len(p_samples["p"]) == 2
    assert len(p_samples["feet"]) == 2


def test_export_frontend_artifacts(tmp_path):
    summary = {
        "total_shots_p1": 1,
        "total_shots_p2": 1,
        "avg_shot_speed_p1_kmh": 90.0,
        "avg_shot_speed_p2_kmh": 95.0,
        "court_calibrated": True,
    }
    court_kp = [100, 100, 900, 100, 100, 900, 900, 900] + [500] * 20

    out = export_frontend_artifacts(
        out_dir=tmp_path,
        run_id="test_run_123",
        summary=summary,
        court_keypoints=court_kp,
        fps=30.0,
        frame_width=1000,
        frame_height=1000,
        total_frames=10,
    )

    for key, path in out.items():
        if key != "video":
            assert path.exists()

    meta = json.loads((tmp_path / "meta.json").read_text())
    assert meta["runId"] == "test_run_123"
    assert meta["status"] == "COMPLETED"
