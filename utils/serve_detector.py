"""
utils/serve_detector.py
───────────────────────
Identifies which contact frames are actually serves, from physical evidence.

What this replaces
------------------
`ShotClassifier._determine_shot_type` labelled a shot "Serve" purely because it was
first in the sequence:

    # First shot in sequence is always a serve
    if is_first_shot:
        return self.SHOT_TYPES['SERVE']

That premise only holds if a clip begins exactly at the start of a point. Ours are
cut from mid-match, so the first detected shot is usually a mid-rally groundstroke -
meaning every "Serve" the pipeline had ever reported was this heuristic firing rather
than a serve being recognised. Worse, `classify_shots` skips shot frames with missing
data, so when index 0 was skipped no shot got the flag at all and rallies came back
with no serve whatsoever (measured on six Wimbledon clips, all of which contain real
serves).

The evidence this uses instead
------------------------------
A serve is the only shot in tennis that is simultaneously:

  1. **Struck above the player's head.** The toss puts the ball well over the server -
     contact is around 2.7 m while the player is under 2 m. In image space the ball
     sits above the top edge of the player's bounding box. This alone also catches
     smashes, which share the trait.

  2. **Struck from the baseline or behind it.** This is what separates a serve from a
     smash: smashes are put away near the net, serves are struck from behind the
     baseline. Checked in mini-court space, where the two baselines are known
     geometry rather than image guesswork.

Both must hold. Each is independently measurable, and `explain=True` reports which
one rejected a frame so failures can be diagnosed rather than guessed at.

Deliberately NOT used: "is the first shot", ball direction, or rally position - those
are the assumptions that produced the phantom serves in the first place.
"""
from __future__ import annotations

from utils.bbox_utils import get_center_of_bbox

# How far beyond a baseline a server may stand, as a fraction of court length.
# Servers stand on or just behind the line; 18 % of court length (~4.2 m) accommodates
# deep stances and camera projection distortion at the far baseline.
BASELINE_TOLERANCE_FRAC = 0.18

# The ball clearance threshold expressed as a fraction from the bounding box top (py1).
# During a serve, YOLO boxes include the raised arm and racket, pushing py1 well above
# the player's anatomical head. Allowing up to 0.22 * box_height ensures contacts inside
# the overhead racket-reach zone are properly identified as overhead serves.
HEAD_CLEARANCE_FRAC = 0.22

# Two serves cannot be this close together. A point does not start twice inside a few
# seconds, and even a fault followed by a second serve leaves time to retrieve a ball and
# reset. Expressed in seconds rather than frames so it means the same thing at 25, 30 and
# 60 fps. Deliberately conservative: it only has to reject candidates that are physically
# impossible, not to judge how long a rally lasts.
MIN_SERVE_SEPARATION_S = 3.0


def _hitting_player(frame_players: dict, ball_center, active_ids=None) -> int | None:
    """The player nearest the ball in 2D space, prioritizing active players if provided."""
    if not frame_players:
        return None
    eligible = {
        pid: box for pid, box in frame_players.items()
        if active_ids is None or pid in active_ids
    }
    if not eligible:
        eligible = frame_players

    bx, by = ball_center

    def box_distance(pid):
        x1, y1, x2, y2 = eligible[pid]
        dx = max(x1 - bx, 0.0, bx - x2)
        dy = max(y1 - by, 0.0, by - y2)
        return (dx * dx + dy * dy) ** 0.5

    return min(eligible, key=box_distance)


def is_serve(
    frame: int,
    ball_detections: list[dict],
    player_detections: list[dict],
    player_mini_court: dict,
    far_baseline_y: float,
    near_baseline_y: float,
    explain: bool = False,
):
    """
    Decide whether the contact at `frame` is a serve.

    Args:
        frame:             contact frame index.
        ball_detections:   per-frame {ball_id: bbox} in image space.
        player_detections: per-frame {player_id: bbox} in image space.
        player_mini_court: {frame: {player_id: (x, y)}} in mini-court space.
        far_baseline_y:    mini-court y of the far baseline.
        near_baseline_y:   mini-court y of the near baseline.
        explain:           also return a short reason string.

    Returns:
        bool, or (bool, reason) when `explain` is True.
    """
    def result(verdict: bool, reason: str):
        return (verdict, reason) if explain else verdict

    if frame >= len(ball_detections) or frame >= len(player_detections):
        return result(False, "frame out of range")

    # Temporal fallback for ball detection (search +/-2 frames if missing on contact)
    ball_box = None
    for offset in (0, -1, 1, -2, 2):
        fn = frame + offset
        if 0 <= fn < len(ball_detections):
            box = ball_detections[fn].get(1)
            if box:
                ball_box = box
                break
    if not ball_box:
        return result(False, "no ball detection at contact")

    # Temporal fallback for player detections
    frame_players = player_detections[frame] if frame < len(player_detections) else {}
    if not frame_players:
        for offset in (-1, 1, -2, 2):
            fn = frame + offset
            if 0 <= fn < len(player_detections) and player_detections[fn]:
                frame_players = player_detections[fn]
                break

    active_ids = set()
    for f_pos in player_mini_court.values():
        active_ids.update(f_pos.keys())
    active_ids = active_ids if active_ids else None

    ball_centre = get_center_of_bbox(ball_box)
    player_id = _hitting_player(frame_players, ball_centre, active_ids=active_ids)
    if player_id is None:
        return result(False, "no player detected at contact")

    # ── Evidence 1: ball above the player's head ──────────────────────────────
    px1, py1, px2, py2 = frame_players[player_id]
    box_height = py2 - py1
    if ball_centre[1] > py1 + HEAD_CLEARANCE_FRAC * box_height:
        return result(False, "ball not above player's head")

    # ── Evidence 2: struck from the baseline or behind it ─────────────────────
    position = player_mini_court.get(frame, {}).get(player_id)
    if position is None:
        for offset in (-1, 1, -2, 2, -3, 3):
            fn = frame + offset
            pos = player_mini_court.get(fn, {}).get(player_id)
            if pos is not None:
                position = pos
                break
    if position is None:
        return result(False, "no mini-court position for hitter")

    court_length = abs(near_baseline_y - far_baseline_y)
    tolerance = BASELINE_TOLERANCE_FRAC * court_length
    behind_far = position[1] <= far_baseline_y + tolerance
    behind_near = position[1] >= near_baseline_y - tolerance
    if not (behind_far or behind_near):
        return result(False, "hitter is not at a baseline (smash, not serve)")

    return result(True, f"serve by player {player_id}")


def _ball_clearance(frame: int, ball_detections: list[dict],
                    player_detections: list[dict],
                    player_mini_court: dict | None = None) -> float:
    """
    How far above the hitter's head the ball sits, in that player's own box heights.

    Used only to choose between serve candidates that are too close together in time.
    Normalising by box height makes near and far players comparable, since the same real
    clearance is far fewer pixels at the back of the court.
    """
    ball_box = None
    for offset in (0, -1, 1, -2, 2):
        fn = frame + offset
        if 0 <= fn < len(ball_detections):
            box = ball_detections[fn].get(1)
            if box:
                ball_box = box
                break
    frame_players = player_detections[frame] if frame < len(player_detections) else {}
    if not frame_players:
        for offset in (-1, 1, -2, 2):
            fn = frame + offset
            if 0 <= fn < len(player_detections) and player_detections[fn]:
                frame_players = player_detections[fn]
                break
    if not ball_box or not frame_players:
        return float("-inf")
    ball_centre = get_center_of_bbox(ball_box)
    active_ids = set()
    if player_mini_court:
        for f_pos in player_mini_court.values():
            active_ids.update(f_pos.keys())
    player_id = _hitting_player(frame_players, ball_centre, active_ids=active_ids if active_ids else None)
    if player_id is None:
        return float("-inf")
    px1, py1, px2, py2 = frame_players[player_id]
    height = py2 - py1
    if height <= 0:
        return float("-inf")
    return (py1 - ball_centre[1]) / height


def detect_serve_frames(
    contact_frames: list[int],
    ball_detections: list[dict],
    player_detections: list[dict],
    player_mini_court: dict,
    far_baseline_y: float,
    near_baseline_y: float,
    fps: float = 30.0,
    single_rally: bool = False,
) -> list[int]:
    """
    Subset of `contact_frames` that carry serve evidence, in order.

    In `single_rally=True` mode, at most ONE serve can exist, and it MUST be the opening
    shot of the rally. Mid-rally shots (returns, groundstrokes, smashes) cannot be serves
    under the rules of tennis.

    When `single_rally=False`, serves closer together than MIN_SERVE_SEPARATION_S are
    collapsed to one via temporal clustering across the full match video.
    """
    candidates = [
        frame for frame in sorted(contact_frames)
        if is_serve(frame, ball_detections, player_detections, player_mini_court,
                    far_baseline_y, near_baseline_y)
    ]
    if not candidates:
        return []

    if single_rally:
        if not contact_frames:
            return []
        first_contact = sorted(contact_frames)[0]
        # In a single rally, only the opening shot can be a serve
        opening_window = max(1, int(round(0.75 * max(fps, 1.0))))
        opening_candidates = [
            f for f in candidates
            if abs(f - first_contact) <= opening_window
        ]
        if not opening_candidates:
            return []
        return [max(opening_candidates, key=lambda f: _ball_clearance(f, ball_detections, player_detections, player_mini_court))]

    if len(candidates) < 2:
        return candidates

    min_gap = max(1, int(round(MIN_SERVE_SEPARATION_S * max(fps, 1.0))))

    clusters: list[list[int]] = [[candidates[0]]]
    for frame in candidates[1:]:
        if frame - clusters[-1][0] <= min_gap:
            clusters[-1].append(frame)
        else:
            clusters.append([frame])

    return [
        max(cluster, key=lambda f: _ball_clearance(f, ball_detections, player_detections))
        for cluster in clusters
    ]
