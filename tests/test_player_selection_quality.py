"""
tests/test_player_selection_quality.py
───────────────────────────────────────
Guards the player-selection sanity gate.

Why it exists: the court-validity gate stops a clip whose COURT was fitted to the crowd.
Nothing stopped a clip whose PLAYERS were. Measured across the nine evaluation clips
(`eval/player_selection_sanity.py`), `input_video_11` passes the court gate comfortably at
0.327 line support and still selects two tracks on the same side of the net, one present
for 40% of frames with a 199-frame hole in the middle. The pipeline reported confident
per-player numbers on it.

Singles is played across the net, so "both selected tracks are on the same half" is
decidable with no ground truth at all. That is the same kind of reasoning the rally
grammar and the court gate already use, and it is what these tests pin.

They also pin the serialisation, because the first working version of this gate wrote a
numpy.bool_ into summary.json, which json.dump refuses: the file was written as far as
that key and then truncated. A gate whose output cannot be saved reports nothing.
"""
import json
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

import numpy as np
import pytest

from utils.player_selection import (
    MIN_COVERAGE,
    SELECTION_DEGRADED,
    SELECTION_FAILED,
    SELECTION_OK,
    assess_selection,
)

NET_Y = 400.0
NEAR_FEET = 600.0    # below the net line in image space
FAR_FEET = 200.0     # above it


def frames(n=100, near=None, far=None):
    """n frames with player 1 near and player 2 far, present on the given frame indices."""
    near = range(n) if near is None else near
    far = range(n) if far is None else far
    out = []
    for i in range(n):
        frame = {}
        if i in near:
            frame[1] = [10.0, 100.0, 40.0, NEAR_FEET]
        if i in far:
            frame[2] = [10.0, 100.0, 40.0, FAR_FEET]
        out.append(frame)
    return out


# ── the healthy case ────────────────────────────────────────────────────────────

def test_two_players_tracked_throughout_is_ok():
    result = assess_selection(frames(), NET_Y, people_detected=14)

    assert result.status == SELECTION_OK
    assert result.is_ok
    assert result.opposite_sides
    assert result.coverage == (1.0, 1.0)
    assert result.longest_gaps == (0, 0)


def test_a_few_scattered_misses_are_still_ok():
    """Real tracking drops the odd frame. The gate must not fire on that."""
    present = [i for i in range(100) if i % 25]
    result = assess_selection(frames(near=present), NET_Y, people_detected=14)

    assert result.status == SELECTION_OK


# ── the decisive failure ────────────────────────────────────────────────────────

def test_both_tracks_on_the_same_side_is_a_failure():
    """
    input_video_11's signature. Singles is played across the net, so two tracks on one
    half cannot both be players, whatever their coverage looks like.
    """
    same_side = [{1: [10.0, 100.0, 40.0, NEAR_FEET],
                  2: [50.0, 100.0, 80.0, NEAR_FEET + 20]} for _ in range(100)]

    result = assess_selection(same_side, NET_Y, people_detected=40)

    assert result.status == SELECTION_FAILED
    assert not result.opposite_sides
    assert "same side of the net" in result.reason
    assert "not measurements" in result.reason


def test_same_side_outranks_good_coverage():
    """
    Perfect coverage must not rescue a selection that took the wrong people. The
    coverage checks are secondary; the geometry check is decisive.
    """
    same_side = [{1: [10.0, 100.0, 40.0, FAR_FEET],
                  2: [50.0, 100.0, 80.0, FAR_FEET - 20]} for _ in range(100)]

    result = assess_selection(same_side, NET_Y, people_detected=40)

    assert result.coverage == (1.0, 1.0)
    assert result.status == SELECTION_FAILED


# ── degraded, not failed ────────────────────────────────────────────────────────

def test_a_long_continuous_gap_is_degraded():
    """
    Right players, lost for a stretch. Shots played then cannot be attributed, so the
    counts under-count, which is a different and lesser problem than picking the wrong
    people.
    """
    present = list(range(0, 40)) + list(range(70, 100))
    result = assess_selection(frames(near=present), NET_Y, people_detected=14)

    assert result.status == SELECTION_DEGRADED
    assert result.opposite_sides
    assert result.longest_gaps[0] == 30
    assert "under-count" in result.reason


def test_low_coverage_is_degraded():
    present = list(range(0, 50))
    result = assess_selection(frames(near=present), NET_Y, people_detected=14)

    assert result.status == SELECTION_DEGRADED
    assert result.coverage[0] < MIN_COVERAGE


def test_a_missing_player_is_a_failure_not_a_gap():
    """One side never selected at all cannot be opposite sides, so it fails outright."""
    result = assess_selection(frames(far=[]), NET_Y, people_detected=14)

    assert result.status == SELECTION_FAILED


# ── the output has to survive being written ─────────────────────────────────────

def test_as_dict_is_json_serialisable_with_numpy_inputs():
    """
    The regression. Bounding boxes arrive as numpy scalars, so the comparison produced a
    numpy.bool_ and json.dump truncated summary.json at that key.
    """
    numpy_frames = [{1: [np.float32(10), np.float32(100), np.float32(40),
                         np.float32(NEAR_FEET)],
                     2: [np.float32(10), np.float32(100), np.float32(40),
                         np.float32(FAR_FEET)]} for _ in range(50)]

    payload = assess_selection(numpy_frames, np.float32(NET_Y),
                               people_detected=np.int64(12)).as_dict()

    text = json.dumps(payload)
    assert json.loads(text)["players_on_opposite_sides"] is True
    for key, value in payload.items():
        assert type(value) in (str, int, float, bool), f"{key} is {type(value)}"


def test_failed_and_degraded_payloads_carry_the_warning():
    same_side = [{1: [10.0, 100.0, 40.0, NEAR_FEET],
                  2: [50.0, 100.0, 80.0, NEAR_FEET]} for _ in range(50)]

    assert "warning" in assess_selection(same_side, NET_Y, 40).as_dict()
    assert "warning" not in assess_selection(frames(), NET_Y, 14).as_dict()


# ── never raises ────────────────────────────────────────────────────────────────

@pytest.mark.parametrize("selected", [[], [{}], [{} for _ in range(10)]])
def test_empty_input_does_not_raise(selected):
    """
    A clip where nobody was selected must report a failure, not crash the run. The gate
    exists to describe bad outcomes, so a bad outcome cannot be an exception path.
    """
    result = assess_selection(selected, NET_Y, people_detected=0)
    assert result.status == SELECTION_FAILED
    json.dumps(result.as_dict())


def test_player_track_stitching():
    """Verify that PlayerTracker stitches fragmented track IDs within court halves."""
    from trackers.player_tracker import PlayerTracker
    pt = PlayerTracker.__new__(PlayerTracker)

    court_kp = [
        580, 240, 1340, 240, 450, 480, 1470, 480,
        250, 920, 1670, 920, 450, 240, 1470, 240,
        450, 920, 1470, 920, 960, 240, 960, 920,
        960, 480, 960, 700
    ]

    # 100 frames:
    # First 50 frames: Bottom player is ID 2, Top player is ID 3
    # Next 50 frames: Bottom player is ID 35, Top player is ID 38
    player_dets = []
    for i in range(100):
        frame = {}
        if i < 50:
            frame[2] = [800, 700, 900, 850]    # bottom
            frame[3] = [800, 280, 880, 390]    # top
        else:
            frame[35] = [810, 710, 910, 860]   # bottom
            frame[38] = [810, 290, 890, 400]   # top
        player_dets.append(frame)

    filtered = pt.choose_and_filter_players(player_dets, court_kp)
    assert len(filtered) == 100

    # Ensure coverage is 100% across all 100 frames after stitching
    all_keys = set(k for f in filtered for k in f)
    assert len(all_keys) == 2
    for f in filtered:
        assert len(f) == 2

