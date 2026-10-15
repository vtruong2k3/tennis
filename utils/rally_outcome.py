"""
utils/rally_outcome.py
──────────────────────
Evaluates rally conclusions and assigns point winners according to ITF tennis rules.

Outcome Types:
- WINNER: The final shot landed in court and was not returned (or bounced twice).
          The striker wins the point.
- OUT_ERROR: The final shot landed outside court lines (verified by Hawkeye ELC).
             The opponent wins the point.
- NET_ERROR: The final shot struck the net or dropped before crossing into the opponent's side.
             The opponent wins the point.
- UNRESOLVED: Insufficient post-rally evidence to declare a definitive outcome.
"""
from __future__ import annotations

import logging
from dataclasses import dataclass, field
from typing import Sequence

logger = logging.getLogger(__name__)

WINNER = "WINNER"
OUT_ERROR = "OUT_ERROR"
NET_ERROR = "NET_ERROR"
UNRESOLVED = "UNRESOLVED"


@dataclass(frozen=True)
class RallyOutcome:
    winner_player_id: int | None
    loser_player_id: int | None
    outcome_type: str
    final_shot_type: str | None
    final_shot_frame: int | None
    reasons: list[str] = field(default_factory=list)

    def as_dict(self) -> dict:
        return {
            "winner_player_id": self.winner_player_id,
            "loser_player_id": self.loser_player_id,
            "outcome_type": self.outcome_type,
            "final_shot_type": self.final_shot_type,
            "final_shot_frame": self.final_shot_frame,
            "reasons": list(self.reasons),
        }


def determine_rally_outcome(
    shots: Sequence[dict],
    bounces: Sequence[dict] | None = None,
    hawkeye_calls: Sequence[dict] | None = None,
    player_ids: Sequence[int] = (1, 2),
) -> RallyOutcome:
    """
    Determines which player won the rally and why.

    Args:
        shots: ordered sequence of shot dicts with keys:
               {'frame': int, 'player_id': int, 'shot_type': str}
        bounces: optional ordered sequence of bounce dicts with keys:
               {'frame': int, 'court_pos_m': tuple[float, float] (x, y)}
        hawkeye_calls: optional sequence of ELC verdicts:
               {'frame': int, 'call': 'IN' | 'OUT'}
        player_ids: tuple of the two active player IDs.

    Returns:
        RallyOutcome dataclass.
    """
    if not shots:
        return RallyOutcome(
            winner_player_id=None,
            loser_player_id=None,
            outcome_type=UNRESOLVED,
            final_shot_type=None,
            final_shot_frame=None,
            reasons=["No shot detected in rally."],
        )

    last_shot = shots[-1]
    striker_id = last_shot.get("player_id")
    shot_frame = last_shot.get("frame")
    shot_type = last_shot.get("shot_type", "Groundstroke")

    # Determine opponent ID
    opponent_id = None
    if striker_id in player_ids:
        for pid in player_ids:
            if pid != striker_id:
                opponent_id = pid
                break
    if opponent_id is None:
        opponent_id = 2 if striker_id == 1 else 1

    # Check for Hawkeye calls or bounces that occur after the last shot
    relevant_calls = [
        c for c in (hawkeye_calls or [])
        if c.get("frame", 0) > (shot_frame or 0)
    ]

    for call_info in relevant_calls:
        if call_info.get("call") == "OUT":
            return RallyOutcome(
                winner_player_id=opponent_id,
                loser_player_id=striker_id,
                outcome_type=OUT_ERROR,
                final_shot_type=shot_type,
                final_shot_frame=shot_frame,
                reasons=[
                    f"Final shot by Player {striker_id} landed OUT at frame {call_info.get('frame')}.",
                    f"Point awarded to Player {opponent_id}."
                ],
            )

    relevant_bounces = [
        b for b in (bounces or [])
        if b.get("frame", 0) > (shot_frame or 0)
    ]

    # If the ball bounced on court and opponent failed to return
    if relevant_bounces:
        first_bounce = relevant_bounces[0]
        # Check if landing was within half court bounds (ITF singles width <= 4.115m from center)
        pos = first_bounce.get("court_pos_m")
        if pos is not None and len(pos) >= 2:
            x_m, y_m = float(pos[0]), float(pos[1])
            is_out = abs(x_m) > 4.25 or abs(y_m) > 12.0
            if is_out:
                return RallyOutcome(
                    winner_player_id=opponent_id,
                    loser_player_id=striker_id,
                    outcome_type=OUT_ERROR,
                    final_shot_type=shot_type,
                    final_shot_frame=shot_frame,
                    reasons=[
                        f"Final shot landed beyond baseline/sideline (x={x_m:.2f}m, y={y_m:.2f}m).",
                        f"Point awarded to Player {opponent_id}."
                    ],
                )

        return RallyOutcome(
            winner_player_id=striker_id,
            loser_player_id=opponent_id,
            outcome_type=WINNER,
            final_shot_type=shot_type,
            final_shot_frame=shot_frame,
            reasons=[
                f"Player {striker_id} hit a legal {shot_type} in court.",
                f"Opponent {opponent_id} was unable to return the ball."
            ],
        )

    # If there is no bounce after the last shot, check net error
    return RallyOutcome(
        winner_player_id=opponent_id,
        loser_player_id=striker_id,
        outcome_type=NET_ERROR,
        final_shot_type=shot_type,
        final_shot_frame=shot_frame,
        reasons=[
            f"Ball from Player {striker_id}'s {shot_type} failed to cross the net into opponent's court.",
            f"Point awarded to Player {opponent_id}."
        ],
    )
