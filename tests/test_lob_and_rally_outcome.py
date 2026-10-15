"""
tests/test_lob_and_rally_outcome.py
Unit tests for point outcome determination according to ITF tennis rules:
- Winner: legal shot in court, opponent fails to return
- Out error: ball lands outside boundaries (Hawkeye or coordinates)
- Net error: ball fails to reach opponent court
"""
import os
import sys

sys.path.insert(0, os.path.dirname(os.path.dirname(os.path.abspath(__file__))))

from utils.rally_outcome import (
    NET_ERROR,
    OUT_ERROR,
    UNRESOLVED,
    WINNER,
    determine_rally_outcome,
)


def test_winner_when_shot_in_and_unreturned():
    shots = [
        {"frame": 10, "player_id": 1, "shot_type": "Serve"},
        {"frame": 45, "player_id": 2, "shot_type": "Forehand"},
        {"frame": 80, "player_id": 1, "shot_type": "Forehand"},
    ]
    bounces = [
        {"frame": 95, "court_pos_m": (2.1, 8.5)}, # Lands in Player 2 court
    ]
    outcome = determine_rally_outcome(shots, bounces=bounces, player_ids=(1, 2))
    assert outcome.outcome_type == WINNER
    assert outcome.winner_player_id == 1
    assert outcome.loser_player_id == 2
    assert outcome.final_shot_type == "Forehand"


def test_out_error_from_hawkeye():
    shots = [
        {"frame": 50, "player_id": 2, "shot_type": "Backhand"},
    ]
    hawkeye_calls = [
        {"frame": 75, "call": "OUT"},
    ]
    outcome = determine_rally_outcome(shots, hawkeye_calls=hawkeye_calls, player_ids=(1, 2))
    assert outcome.outcome_type == OUT_ERROR
    assert outcome.winner_player_id == 1
    assert outcome.loser_player_id == 2


def test_out_error_from_court_coords():
    shots = [
        {"frame": 50, "player_id": 1, "shot_type": "Forehand"},
    ]
    bounces = [
        {"frame": 65, "court_pos_m": (5.2, 10.0)}, # Width 5.2m is beyond singles 4.115m
    ]
    outcome = determine_rally_outcome(shots, bounces=bounces, player_ids=(1, 2))
    assert outcome.outcome_type == OUT_ERROR
    assert outcome.winner_player_id == 2
    assert outcome.loser_player_id == 1


def test_net_error_when_no_bounce():
    shots = [
        {"frame": 40, "player_id": 2, "shot_type": "Forehand"},
    ]
    outcome = determine_rally_outcome(shots, bounces=[], hawkeye_calls=[], player_ids=(1, 2))
    assert outcome.outcome_type == NET_ERROR
    assert outcome.winner_player_id == 1
    assert outcome.loser_player_id == 2


def test_unresolved_when_empty_shots():
    outcome = determine_rally_outcome([])
    assert outcome.outcome_type == UNRESOLVED
    assert outcome.winner_player_id is None
