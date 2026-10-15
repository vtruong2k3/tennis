"""
utils/hit_bounce_classifier.py
───────────────────────────────
Classifies a floor-level ball event (from utils.ball_state.classify_floor_level) as a
CONTACT (player hit) or BOUNCE (court), using ball-trajectory shape alone - no player
position needed.

Why this exists
----------------
The player-proximity heuristic in classify_contact_vs_bounce has a measured ~5/7 ceiling
on our own footage that turned out to be mostly an artifact of an
incomplete ground truth, not the heuristic itself - but while
investigating that, feature exploration on the real 1,034-event TrackNet ground truth
(eval/explore_hit_bounce_features.py) found a much stronger, complementary signal:

  A bounce is a court reflection - mostly preserves horizontal (x) velocity, since the
  ground doesn't impart much sideways force. A hit is a player redirecting the ball, which
  can reverse or sharply change x-direction (cross-court shots, returns). Measured: hits
  flip x-direction 71.8% of the time, bounces only 2.1% of the time.

A 4-feature logistic regression (height, |vertical-velocity change|, |horizontal-velocity
change|, and whether x-direction flipped) trained on that data reaches 86.4% held-out
accuracy on a clip-level split (not event-level, which would leak camera/lighting/player
correlations) - see eval/train_hit_bounce_classifier.py for the full methodology and
eval/journal 0012 for the honest numbers.

That feature set was chosen on end-to-end shot F1, not on this accuracy. A six-feature
variant scores higher here (89.3%) and measurably worse in the pipeline (rally F1 0.600
against 0.824), because the extra features are raw signed velocities that are clean in
the hand-annotated training data and noisy in real TrackNet detections. The comment above
FEATURE_NAMES in the training script has the full table.

This is trajectory-only and needs no player detection, so it works even when player
tracking is unavailable, and combines naturally with the proximity heuristic where player
positions ARE available (main.py can use both and let them agree/disagree as a signal).
"""
from __future__ import annotations

import json
import logging
from pathlib import Path

from .ball_state import CONTACT, BOUNCE

logger = logging.getLogger(__name__)

# Resolved from this file's location, not the working directory. As a bare relative path
# it only worked when the process happened to be started from the repo root: run from
# anywhere else, or installed as a wheel, the weights were "not found", the classifier
# returned None for every event, and the pipeline fell back to the player-proximity
# heuristic without anything in the output saying so.
DEFAULT_WEIGHTS_PATH = str(
    Path(__file__).resolve().parent.parent / "models" / "hit_bounce_classifier.json"
)
EVENT_WINDOW = 4   # frames before/after the event used to compute velocity - must match
                    # the WINDOW constant in eval/explore_hit_bounce_features.py, since
                    # the trained weights assume this exact window size.

_cached_weights: dict | None = None
_cached_path: str | None = None


def _load_weights(path: str = DEFAULT_WEIGHTS_PATH) -> dict | None:
    global _cached_weights, _cached_path
    if _cached_weights is not None and _cached_path == path:
        return _cached_weights

    if not Path(path).exists():
        logger.warning(
            f"Hit/bounce classifier weights not found at '{path}'. "
            f"Train with: python eval/train_hit_bounce_classifier.py"
        )
        return None

    # encoding pinned: read_text() defaults to the platform locale (cp1252 on
    # Windows, utf-8 on Linux), which is the same host-dependent assumption that
    # put an absolute path into the 3-D viewer. The weights are ASCII today, so this
    # is prevention rather than a live bug.
    _cached_weights = json.loads(Path(path).read_text(encoding="utf-8"))
    _cached_path = path
    return _cached_weights


def compute_event_features(
    positions: list[tuple[float, float] | None],
    event_frame: int,
    window: int | None = None,
    fps: float = 30.0,
) -> dict | None:
    """
    Extract the trajectory-shape features the classifier needs around `event_frame`.
    Normalizes per-frame velocities by (fps / 30.0) so classifier weights trained at
    30 fps maintain invariant physical meaning across 60 fps or slow-motion clips.

    Args:
        positions: per-frame (x, y) ball centre, or None where undetected. Index must
                   align with `event_frame`.
        event_frame: the floor-level candidate frame (from classify_floor_level).
        window:    frames of context required on each side (defaults to EVENT_WINDOW at 30fps).
        fps:       sequence frame rate (e.g. 30.0 or 60.0).

    Returns:
        The six trained features, or None if there isn't enough clean position data
        around this frame to compute velocity on both sides.
    """
    if event_frame < 0 or event_frame >= len(positions) or positions[event_frame] is None:
        return None

    if window is None:
        window = max(2, int(round(EVENT_WINDOW * (fps / 30.0))))

    before = [p for p in positions[max(0, event_frame - window):event_frame] if p is not None]
    after  = [p for p in positions[event_frame + 1:min(len(positions), event_frame + 1 + window)] if p is not None]
    if len(before) < 2 or len(after) < 2:
        return None

    scale = fps / 30.0
    vx_before = ((before[-1][0] - before[0][0]) / (len(before) - 1)) * scale
    vy_before = ((before[-1][1] - before[0][1]) / (len(before) - 1)) * scale
    vx_after  = ((after[-1][0] - after[0][0]) / (len(after) - 1)) * scale
    vy_after  = ((after[-1][1] - after[0][1]) / (len(after) - 1)) * scale

    # These must match eval/explore_hit_bounce_features.py exactly, including the
    # convention below: the trained weights assume this encoding, and a mismatch here
    # would be silent - the model would still return confident probabilities from
    # features that no longer mean what it learned.
    return {
        "height_y": positions[event_frame][1],
        "vy_change_mag": abs(vy_after - vy_before),
        "vy_before": vy_before,
        "vy_after": vy_after,
        "vx_change_mag": abs(vx_after - vx_before),
        # 1 when the ball reversed horizontally, which is a racket redirecting it
        # (71.8% of hits, 2.1% of bounces). Below 0.5 px/frame the direction is noise
        # rather than motion, so it is reported as "no flip" - the same collapse
        # training applies when this feature is absent.
        "vx_sign_flip": float(
            abs(vx_before) > 0.5 and abs(vx_after) > 0.5 and (vx_before > 0) != (vx_after > 0)
        ),
    }


def classify_hit_or_bounce(
    features: dict | None,
    weights_path: str = DEFAULT_WEIGHTS_PATH,
) -> tuple[str, float] | None:
    """
    Classify a floor-level event as CONTACT or BOUNCE from its trajectory features.

    Args:
        features: from compute_event_features(); None passes through as None (honest
                  absence, not a guess - matches the convention in pose_shot_classifier).
        weights_path: trained weights, see eval/train_hit_bounce_classifier.py.

    Returns:
        (CONTACT | BOUNCE, probability of the returned label), or None if features are
        missing or weights aren't trained yet.
    """
    if features is None:
        return None

    weights = _load_weights(weights_path)
    if weights is None:
        return None

    # A feature the weights were trained on but the caller did not compute is a bug in
    # this file, not a runtime condition: it means compute_event_features and the trained
    # model have drifted apart. Say so, rather than raising a bare KeyError - and never
    # default it to 0, which would keep returning confident probabilities from an input
    # the model never saw.
    absent = [n for n in weights["feature_names"] if n not in features]
    if absent:
        raise ValueError(
            f"trained weights expect {weights['feature_names']} but these were not "
            f"computed: {absent}. compute_event_features() and the weights in "
            f"{weights_path} are out of sync - retrain, or update the feature computation."
        )

    x = [features[name] for name in weights["feature_names"]]
    mu, sigma, w, b = weights["mu"], weights["sigma"], weights["w"], weights["b"]

    z = b
    for xi, mui, sigi, wi in zip(x, mu, sigma, w):
        z += wi * ((xi - mui) / sigi)

    p_hit = 1.0 / (1.0 + pow(2.718281828, -z))
    if p_hit >= 0.5:
        return CONTACT, p_hit
    return BOUNCE, 1.0 - p_hit


def detect_xvelocity_candidates(
    ball_detections: list[dict],
    min_delta_x: float | None = None,
    min_spacing: int | None = None,
    window: int | None = None,
    fps: float = 30.0,
) -> list[int]:
    """
    Candidate contact/bounce frames from local peaks in |horizontal-velocity change|,
    complementing (not replacing) trajectory-reversal detection.
    Automatically scales context window, threshold, and spacing according to frame rate (fps).

    Why this exists: journal 0014 found a structural gap in y-reversal-only detection -
    some real contacts (verified on the reference clip) don't reverse vertical direction
    at all, or reverse too shallowly to separate from noise at any threshold (swept
    min_delta_y down to 1 with no improvement). But the same clip's real shots often DO
    show a sharp change in horizontal velocity (the physical signal behind
    hit_bounce_classifier - journal 0012), even when the vertical trajectory barely moves.

    Args:
        ball_detections: per-frame {1: [x1,y1,x2,y2]} (same format as get_ball_shot_frames).
        min_delta_x:     minimum |vx change| to count as a candidate peak.
                         Defaults to 5.0 at 30fps, scaled with fps.
        min_spacing:     minimum frames between two candidates.
                         Defaults to 15 at 30fps, scaled with fps.
        window:          frames of context on each side used to compute velocity.
                         Defaults to EVENT_WINDOW at 30fps, scaled with fps.
        fps:             sequence frame rate (e.g. 30.0 or 60.0).

    Returns:
        Candidate frame indices, sorted, at least min_spacing apart.
    """
    if min_spacing is None:
        min_spacing = max(10, int(round(15.0 * (fps / 30.0))))
    if window is None:
        window = max(2, int(round(EVENT_WINDOW * (fps / 30.0))))
    if min_delta_x is None:
        min_delta_x = 5.0 * (30.0 / fps)

    positions: list[tuple[float, float] | None] = []
    for det in ball_detections:
        bbox = det.get(1)
        if bbox is not None:
            positions.append(((bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0))
        else:
            positions.append(None)

    n = len(positions)
    scores = [0.0] * n
    for i in range(window, n - window):
        before = [p for p in positions[i - window:i] if p is not None]
        after  = [p for p in positions[i + 1:i + 1 + window] if p is not None]
        if len(before) < 2 or len(after) < 2:
            continue
        vx_before = (before[-1][0] - before[0][0]) / (len(before) - 1)
        vx_after  = (after[-1][0] - after[0][0]) / (len(after) - 1)
        scores[i] = abs(vx_after - vx_before)

    candidates: list[int] = []
    for i in range(n):
        if scores[i] < min_delta_x:
            continue
        lo, hi = max(0, i - min_spacing // 2), min(n, i + min_spacing // 2 + 1)
        if scores[i] == max(scores[lo:hi]):
            if not candidates or i - candidates[-1] >= min_spacing:
                candidates.append(i)

    return candidates


def merge_nearby_candidates(
    candidates: list[int],
    min_gap: int = 10,
    ball_detections: list[dict] | None = None,
    fps: float = 30.0,
    min_gap_sec: float | None = None,
) -> list[int]:
    """
    Collapse candidates within min_gap frames of each other into one representative
    frame per cluster (the cluster's median or trajectory impulse peak).

    Supports trajectory-aware candidate merging and frame-rate normalization:
    - If ball_detections is provided, candidates within min_gap that exhibit separate,
      distinct directional deflections (e.g. rapid volley exchange) are kept separate,
      recovering real contacts that a fixed frame gap previously destroyed.
    - If candidates are duplicate detections of the same single deflection, they collapse
      to the frame with the highest trajectory impulse (or cluster median).
    - If min_gap_sec is specified, cluster width is normalized across frame rates:
      gap_frames = max(2, round(min_gap_sec * fps)).

    Args:
        candidates:      raw candidate frames (e.g. union of ball generators).
        min_gap:         cluster width in frames (used when min_gap_sec is None).
        ball_detections: optional per-frame ball bounding boxes for trajectory impulse check.
        fps:             frame rate of the video.
        min_gap_sec:     cluster width in seconds (normalizes across frame rates).

    Returns:
        One representative frame per cluster, sorted.
    """
    if not candidates:
        return []

    gap_frames = max(2, round(min_gap_sec * fps)) if min_gap_sec is not None else min_gap
    ordered = sorted(set(candidates))
    if len(ordered) <= 1:
        return list(ordered)

    if not ball_detections:
        clusters: list[list[int]] = [[ordered[0]]]
        for c in ordered[1:]:
            if c - clusters[-1][0] <= gap_frames:
                clusters[-1].append(c)
            else:
                clusters.append([c])
        return [cluster[len(cluster) // 2] for cluster in clusters]

    # Trajectory-aware clustering
    n_det = len(ball_detections)
    positions: list[tuple[float, float] | None] = []
    for det in ball_detections:
        bbox = det.get(1)
        if bbox is not None:
            positions.append(((bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0))
        else:
            positions.append(None)

    def _trajectory_impulse(frame: int, window: int = 3) -> tuple[float, float]:
        if frame < 0 or frame >= n_det or positions[frame] is None:
            return 0.0, 0.0
        before = [p for p in positions[max(0, frame - window):frame] if p is not None]
        after = [p for p in positions[frame + 1:min(n_det, frame + 1 + window)] if p is not None]
        if len(before) < 1 or len(after) < 1:
            return 0.0, 0.0
        vx_in = (positions[frame][0] - before[0][0]) / max(1, len(before))
        vy_in = (positions[frame][1] - before[0][1]) / max(1, len(before))
        vx_out = (after[-1][0] - positions[frame][0]) / max(1, len(after))
        vy_out = (after[-1][1] - positions[frame][1]) / max(1, len(after))
        dvx = vx_out - vx_in
        dvy = vy_out - vy_in
        impulse_mag = (dvx * dvx + dvy * dvy) ** 0.5
        speed_in = (vx_in * vx_in + vy_in * vy_in) ** 0.5
        speed_out = (vx_out * vx_out + vy_out * vy_out) ** 0.5
        angle_deg = 0.0
        if speed_in > 0.5 and speed_out > 0.5:
            dot = (vx_in * vx_out + vy_in * vy_out) / (speed_in * speed_out)
            dot = max(-1.0, min(1.0, dot))
            import math
            angle_deg = math.degrees(math.acos(dot))
        return impulse_mag, angle_deg

    candidate_impulses = {c: _trajectory_impulse(c) for c in ordered}

    clusters: list[list[int]] = [[ordered[0]]]
    for c in ordered[1:]:
        prev_cluster = clusters[-1]
        gap_from_start = c - prev_cluster[0]
        if gap_from_start <= gap_frames:
            mag_c, angle_c = candidate_impulses[c]
            mag_p, angle_p = candidate_impulses[prev_cluster[-1]]
            is_distinct_hit = (
                (c - prev_cluster[-1] >= 3)
                and (mag_c > 4.0 and mag_p > 4.0)
                and (angle_c > 40.0 and angle_p > 40.0)
            )
            if is_distinct_hit:
                clusters.append([c])
            else:
                prev_cluster.append(c)
        else:
            clusters.append([c])

    merged: list[int] = []
    for cluster in clusters:
        if len(cluster) == 1:
            merged.append(cluster[0])
        else:
            best_f = cluster[len(cluster) // 2]
            best_mag = -1.0
            for f in cluster:
                mag, _ = candidate_impulses[f]
                if mag > best_mag and mag > 1.0:
                    best_mag = mag
                    best_f = f
            merged.append(best_f)

    return sorted(merged)


def event_contact_probabilities(
    reversal_frames: list[int],
    ball_detections: list[dict],
    weights_path: str = DEFAULT_WEIGHTS_PATH,
    fps: float = 30.0,
) -> dict[int, float]:
    """
    P(contact) per candidate frame, for frames the trajectory model can decide on.

    Split out of classify_reversals_by_trajectory because constrained decoding
    (utils.rally_decode) needs the probability, not the hard label: a grammar can only
    overrule a classifier if it knows how strongly the classifier objects. Frames with
    no usable trajectory context are absent from the result rather than defaulted.
    """
    positions: list[tuple[float, float] | None] = []
    for det in ball_detections:
        bbox = det.get(1)
        if bbox is not None:
            positions.append(((bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0))
        else:
            positions.append(None)

    probabilities: dict[int, float] = {}
    for frame in reversal_frames:
        result = classify_hit_or_bounce(compute_event_features(positions, frame, fps=fps),
                                        weights_path)
        if result is None:
            continue
        label, confidence = result
        probabilities[frame] = confidence if label == CONTACT else 1.0 - confidence
    return probabilities


def classify_reversals_by_trajectory(
    reversal_frames: list[int],
    ball_detections: list[dict],
    weights_path: str = DEFAULT_WEIGHTS_PATH,
) -> tuple[list[int], list[int]]:
    """
    Drop-in alternative to classify_contact_vs_bounce (utils.ball_state) with the same
    (contacts, bounces) return shape, but using trajectory shape instead of player
    proximity - no player detection needed. See module docstring for why: 84.1% held-out
    accuracy on real data, vs the proximity heuristic's measured ~5/7 ceiling on our own
    footage (which turned out to be mostly an incomplete-ground-truth artifact, but the
    trajectory signal is independently strong regardless - see
    eval/train_hit_bounce_classifier.py).

    Frames where the classifier can't reach a decision (not enough trajectory context,
    or the weights aren't trained) are dropped from both lists rather than guessed.
    """
    probabilities = event_contact_probabilities(
        reversal_frames, ball_detections, weights_path
    )

    contacts, bounces = [], []
    for frame in reversal_frames:
        p_contact = probabilities.get(frame)
        if p_contact is None:
            continue
        (contacts if p_contact >= 0.5 else bounces).append(frame)

    return contacts, bounces


# The proximity contact/bounce fallback measured about 5 correct in 7 on our own footage
# (see the module docstring), so that is the confidence it carries into decoding. It is a
# weak vote by design: the grammar should be able to overrule it, unlike a calibrated
# trajectory probability.
PROXIMITY_RELIABILITY = 5.0 / 7.0


def striking_side(
    frame: int,
    ball_detections: list[dict],
    player_detections: list[dict],
    max_distance_px: float = float("inf"),
) -> int | None:
    """
    Which player was nearest the ball at this frame, or None if it cannot be said.

    Distance is measured to the player's box rather than to its centre, because a near
    player's box is tall: a ball at their feet is far from the box centre while being
    right on the player. It also uses BOTH axes. Comparing horizontal distance alone is
    close to meaningless in a broadcast view, where both players sit near the centre line
    in x while being metres apart in y, and it attributed nearly every contact to the same
    player until the rally self-audit caught it.

    Args:
        max_distance_px: beyond this, return None rather than name a player. The rally
            grammar needs that, because a wrong side makes it reject a real contact. Leave
            unbounded when a nearest player is wanted regardless of distance, as when
            placing a contact on the mini-court.
    """
    if frame >= len(ball_detections) or frame >= len(player_detections):
        return None
    bbox = ball_detections[frame].get(1)
    players = player_detections[frame]
    if bbox is None or not players:
        return None

    ball_x, ball_y = (bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0

    def box_distance(pid):
        x1, y1, x2, y2 = players[pid]
        dx = max(x1 - ball_x, 0.0, ball_x - x2)
        dy = max(y1 - ball_y, 0.0, ball_y - y2)
        return (dx * dx + dy * dy) ** 0.5

    nearest = min(players, key=box_distance)
    return nearest if box_distance(nearest) <= max_distance_px else None


class DecodeNotes(list):
    """
    The decoder's human-readable notes, carrying its machine-readable account alongside.

    A plain list, so every existing caller keeps working: `derive_shot_frames` has six
    of them across main.py and the evals, all unpacking a 4-tuple and most ignoring this
    element entirely. Widening the return signature would have churned five evals that
    are currently correct, for the sake of a diagnostic only main.py reads.

    `.diagnostics` is the dict that reaches summary.json. See
    utils.rally_decode.DecodedRally.diagnostics for what it contains and why it matters:
    the decoder's own docstring warns that repeatedly overruling a confident classifier
    signals an upstream problem, and until now that warning existed only in the log.
    """

    diagnostics: dict = {}


def derive_shot_frames(
    ball_tracker,
    ball_detections: list[dict],
    player_detections: list[dict],
    shot_player_distance_px: int = 300,
    deletion_prior: float | None = None,
    fps: float = 30.0,
    audio_candidates: list[int] | None = None,
):
    """
    Turn ball detections into the pipeline's confirmed shot and bounce frames.

    This exists so the evals grade what the product actually reports. They previously
    stopped at the raw candidate union - the output of the three generators before any
    contact-vs-bounce classification - and scored that as if it were the shot list. On
    the reference clip that union is 25 candidates against 7 real shots, so the eval
    published 28% precision for a stage the pipeline never emits: every bounce in the
    rally was being counted as a false-positive shot. `eval/_ball_source.py` had already
    aligned the *detections* between eval and pipeline; this closes the same gap for
    event derivation, which is where the shot numbers actually come from.

    Three ball generators feed the union because each is blind to a different event shape:
    y-reversal and x-velocity are hit-shaped by construction (x-velocity recalls only
    12% of bounces), while the bounce generator recalls 83.9%. Merging is what stops
    two generators firing on one real event and inflating the count.
    Optional audio_candidates brings the 4th generator: acoustic string-bed transients
    that recover contacts occluded by the player's body.

    Args:
        ball_tracker:             supplies `get_ball_shot_frames` (the y-reversal generator).
        ball_detections:          per-frame {ball_id: bbox}, already interpolated.
        player_detections:        per-frame {player_id: bbox}, for the proximity fallback.
        shot_player_distance_px:  proximity threshold for the fallback classifier.
        deletion_prior:           how readily rally decoding may discard a candidate as
                                  spurious. Defaults to the swept value in
                                  utils.rally_decode; pass 0.0 to disable discarding.
        fps:                      frame rate of the video sequence.
        audio_candidates:         optional frame candidates from acoustic impact onset.

    Returns:
        (shot_frames, bounce_frames, raw_reversal_frames, decode_flips). The first three
        are sorted frame lists; `decode_flips` describes every label the rally grammar
        overruled (see utils.rally_decode), and is empty when the classifier's own
        labelling was already a physically possible rally.
    """
    from .ball_state import classify_contact_vs_bounce
    from .bounce_candidates import detect_bounce_candidates
    from .rally_decode import MEASURED_DELETION_PRIOR, decode_rally

    candidate_set = (
        set(ball_tracker.get_ball_shot_frames(ball_detections))
        | set(detect_xvelocity_candidates(ball_detections, fps=fps))
        | set(detect_bounce_candidates(ball_detections, fps=fps))
    )
    if audio_candidates:
        candidate_set |= set(audio_candidates)

    raw_candidates = sorted(candidate_set)
    raw_reversals = merge_nearby_candidates(
        raw_candidates,
        ball_detections=ball_detections,
        fps=fps,
    )

    # Probabilities rather than labels, because decoding below needs to know how strongly
    # the classifier holds each opinion, not just which way it leans. Computed once and
    # used for both the fallback split and the decode.
    probabilities = event_contact_probabilities(raw_reversals, ball_detections, fps=fps)

    # Reversals the trajectory model cannot decide on (too little context, e.g. near a
    # clip boundary) fall back to player proximity rather than being silently dropped.
    unclassified = [f for f in raw_reversals if f not in probabilities]
    if unclassified:
        prox_contacts, prox_bounces = classify_contact_vs_bounce(
            unclassified, ball_detections, player_detections,
            shot_player_distance_px=shot_player_distance_px,
        )
    else:
        prox_contacts, prox_bounces = [], []

    # Constrained decoding. Each event above was labelled in isolation, which is why the
    # sequence can come out physically impossible (one player hitting twice with no reply
    # in between). Re-label the sequence as a whole, keeping the most likely labelling
    # that a rally permits. This cannot recover an event that was never detected.
    proximity_labels = {f: True for f in prox_contacts}
    proximity_labels.update({f: False for f in prox_bounces})

    # Estimate court net zone dynamically from player distribution
    top_ys, bot_ys = [], []
    for p_dict in player_detections:
        for box in p_dict.values():
            cy = (box[1] + box[3]) / 2.0
            if cy < 500:
                top_ys.append(cy)
            else:
                bot_ys.append(cy)
    if top_ys and bot_ys:
        y_top_mean = sum(top_ys) / len(top_ys)
        y_bot_mean = sum(bot_ys) / len(bot_ys)
        y_net_est = (y_top_mean + y_bot_mean) / 2.0
        court_h_est = y_bot_mean - y_top_mean
        net_zone_lo = y_net_est - 0.15 * court_h_est
        net_zone_hi = y_net_est + 0.15 * court_h_est
        volley_reach_lo = y_net_est - 0.25 * court_h_est
        volley_reach_hi = y_net_est + 0.25 * court_h_est
    else:
        net_zone_lo, net_zone_hi = -1.0, -1.0
        volley_reach_lo, volley_reach_hi = -1.0, -1.0

    # Filter out net-zone mid-flight noise candidates that have no volleyer nearby.
    # In-flight net crossing is neither a groundstroke contact nor a court bounce.
    filtered_reversals = []
    for f in raw_reversals:
        if net_zone_lo > 0 and f < len(ball_detections):
            bbox = ball_detections[f].get(1)
            if bbox is not None:
                ball_y = (bbox[1] + bbox[3]) / 2.0
                if net_zone_lo <= ball_y <= net_zone_hi:
                    players = player_detections[f] if f < len(player_detections) else {}
                    has_volleyer = any(
                        volley_reach_lo <= (p_box[1] + p_box[3]) / 2.0 <= volley_reach_hi
                        for p_box in players.values()
                    )
                    if not has_volleyer:
                        continue
        filtered_reversals.append(f)

    events = []
    for frame in filtered_reversals:
        p_contact = probabilities.get(frame)
        if p_contact is None:
            if frame not in proximity_labels:
                continue
            # The proximity fallback has no calibrated probability, so it enters decoding
            # at its measured reliability rather than as a certainty.
            p_contact = (PROXIMITY_RELIABILITY if proximity_labels[frame]
                         else 1.0 - PROXIMITY_RELIABILITY)
        side = striking_side(frame, ball_detections, player_detections,
                             shot_player_distance_px)

        # Physical constraint 1: No player nearby (ball in free flight) cannot be a player contact
        if side is None:
            p_contact = min(p_contact, 1e-4)

        events.append((frame, p_contact, side))

    if deletion_prior is None:
        deletion_prior = MEASURED_DELETION_PRIOR
    decoded = decode_rally(events, deletion_prior=deletion_prior)

    # Physical constraint 2: Minimum cross-court inter-shot flight time and player reach.
    # Flight across a 23.77m court at rally speeds takes at least 0.65s (39 frames at 60fps).
    min_flight_frames = max(10, int(round(0.65 * fps)))
    volley_flight_frames = max(6, int(round(0.35 * fps)))

    def _is_net_player(frame_idx):
        if frame_idx >= len(player_detections) or volley_reach_lo <= 0:
            return False
        players = player_detections[frame_idx]
        return any(volley_reach_lo <= (p_box[1] + p_box[3]) / 2.0 <= volley_reach_hi for p_box in players.values())

    def _ball_player_dist(frame_idx):
        if frame_idx >= len(ball_detections) or frame_idx >= len(player_detections):
            return float("inf")
        bbox = ball_detections[frame_idx].get(1)
        players = player_detections[frame_idx]
        if bbox is None or not players:
            return float("inf")
        bx, by = (bbox[0] + bbox[2]) / 2.0, (bbox[1] + bbox[3]) / 2.0
        dists = []
        for box in players.values():
            dx = max(box[0] - bx, 0.0, bx - box[2])
            dy = max(box[1] - by, 0.0, by - box[3])
            dists.append((dx * dx + dy * dy) ** 0.5)
        return min(dists) if dists else float("inf")

    filtered_contacts: list[int] = []
    discarded_flight: list[int] = []

    for f in decoded.contacts:
        # A true contact requires a player within realistic reach (<= 160px from bounding box)
        if striking_side(f, ball_detections, player_detections, shot_player_distance_px) is None or _ball_player_dist(f) > 160.0:
            discarded_flight.append(f)
            continue

        if not filtered_contacts:
            filtered_contacts.append(f)
            continue
        prev = filtered_contacts[-1]
        dt = f - prev
        is_net = _is_net_player(f) or _is_net_player(prev)
        req_dt = volley_flight_frames if is_net else min_flight_frames

        if dt < req_dt:
            # Flight time violated: one of the two is a phantom mid-flight trigger.
            # Keep the contact closer to a player's body/racket.
            d_prev = _ball_player_dist(prev)
            d_curr = _ball_player_dist(f)
            if d_curr < d_prev:
                discarded_flight.append(prev)
                filtered_contacts[-1] = f
            else:
                discarded_flight.append(f)
            continue
        filtered_contacts.append(f)

    notes = DecodeNotes(decoded.flips)
    if decoded.discarded:
        notes.append(
            f"{len(decoded.discarded)} candidate(s) discarded as spurious at frames "
            f"{decoded.discarded}: no legal place in the rally, and dropping them was a "
            f"better explanation than promoting them"
        )
    if discarded_flight:
        notes.append(
            f"{len(discarded_flight)} phantom candidate(s) discarded by physical flight-time/reach "
            f"constraints at frames {discarded_flight}"
        )
    notes.diagnostics = decoded.diagnostics()
    return sorted(filtered_contacts), decoded.bounces, raw_reversals, notes
