"""From face samples to a camera path: tracks, active speaker, smoothing, keyframes.

The camera follows the active speaker. It holds still while the subject stays inside a
dead zone, eases toward them when they move, and cuts (rather than pans) when the
active speaker changes to someone far away — like a human editor would.
"""
from __future__ import annotations

from dataclasses import dataclass, field

import numpy as np

from .faces import SAMPLE_FPS, Sample

MATCH_DIST = 0.12        # max x jump (fraction of width) to keep the same track between samples
ACTIVITY_WINDOW = 1.2    # seconds of jaw movement used to judge who is talking
SWITCH_RATIO = 1.4       # another face must be this much more active...
SWITCH_HOLD = 1.0        # ...for this long before the camera switches to them
DEAD_ZONE = 0.05         # subject can drift this far (fraction of width) before the camera moves
EASE = 0.3               # fraction of the remaining distance covered per sample while moving
MAX_SPEED = 0.35         # fraction of width per second
CUT_DISTANCE = 0.2       # speaker changes farther than this are hard cuts
RDP_EPSILON = 0.004      # keyframe simplification tolerance


@dataclass
class Track:
    id: int
    xs: dict[int, float] = field(default_factory=dict)    # sample index -> cx
    jaw: dict[int, float] = field(default_factory=dict)
    size: dict[int, float] = field(default_factory=dict)


def build_tracks(samples: list[Sample]) -> list[Track]:
    tracks: list[Track] = []
    last_x: dict[int, tuple[int, float]] = {}  # track id -> (sample index, x)
    for i, s in enumerate(samples):
        free = {tid for tid, (j, _) in last_x.items() if i - j <= SAMPLE_FPS * 2}  # tracks seen in the last 2 s
        for f in sorted(s.faces, key=lambda f: -f.w):
            best = min(free, key=lambda tid: abs(last_x[tid][1] - f.cx), default=None)
            if best is None or abs(last_x[best][1] - f.cx) > MATCH_DIST:
                tr = Track(id=len(tracks))
                tracks.append(tr)
                best = tr.id
            else:
                free.discard(best)
            tr = tracks[best]
            tr.xs[i], tr.jaw[i], tr.size[i] = f.cx, f.jaw, f.w * f.h
            last_x[best] = (i, f.cx)
    return tracks


def _activity(tr: Track, i: int) -> float:
    """How much this face's mouth has been moving around sample i (talking ≈ varying jaw)."""
    half = int(ACTIVITY_WINDOW * SAMPLE_FPS / 2)
    vals = [tr.jaw[j] for j in range(i - half, i + half + 1) if j in tr.jaw]
    if len(vals) < 3:
        return 0.0
    return float(np.std(vals) + 0.25 * np.mean(np.abs(np.diff(vals))))


def speaker_path(samples: list[Sample], tracks: list[Track]) -> list[float | None]:
    """Target x per sample (None = nobody visible), choosing the active speaker with hysteresis."""
    current: int | None = None
    challenger: tuple[int, int] | None = None  # (track id, since sample)
    out: list[float | None] = []
    for i in range(len(samples)):
        visible = [t for t in tracks if i in t.xs]
        if not visible:
            out.append(None)
            continue
        score = {t.id: _activity(t, i) + 0.02 * t.size[i] for t in visible}
        best = max(score, key=score.get)
        if current not in score:
            current, challenger = best, None
        elif best != current and score[best] > score[current] * SWITCH_RATIO + 0.01:
            if challenger is None or challenger[0] != best:
                challenger = (best, i)
            elif (i - challenger[1]) / SAMPLE_FPS >= SWITCH_HOLD:
                current, challenger = best, None
        else:
            challenger = None
        out.append(tracks[current].xs[i])
    return out


def camera(targets: list[float | None]) -> list[tuple[int, float]]:
    """Smoothed camera x per sample; returns (sample index, x) including hard cuts."""
    filled: list[float] = []
    last = next((x for x in targets if x is not None), 0.5)
    for x in targets:
        last = x if x is not None else last
        filled.append(last)
    cam = filled[0]
    goal = cam
    dt = 1 / SAMPLE_FPS
    points: list[tuple[int, float]] = []
    for i, target in enumerate(filled):
        if abs(target - goal) > CUT_DISTANCE and i > 0 and abs(target - filled[i - 1]) > CUT_DISTANCE:
            cam = goal = target  # speaker switch far away: cut
            points.append((i, cam))
            continue
        if abs(target - cam) > DEAD_ZONE:
            goal = target
        step = (goal - cam) * EASE
        cam += max(-MAX_SPEED * dt, min(MAX_SPEED * dt, step))
        points.append((i, cam))
    return points


def _rdp(pts: list[tuple[float, float]], eps: float) -> list[tuple[float, float]]:
    if len(pts) < 3:
        return pts
    (t0, x0), (t1, x1) = pts[0], pts[-1]
    best, idx = 0.0, 0
    for k in range(1, len(pts) - 1):
        t, x = pts[k]
        expected = x0 + (x1 - x0) * (t - t0) / (t1 - t0) if t1 > t0 else x0
        if abs(x - expected) > best:
            best, idx = abs(x - expected), k
    if best <= eps:
        return [pts[0], pts[-1]]
    return _rdp(pts[: idx + 1], eps)[:-1] + _rdp(pts[idx:], eps)


def keyframes(samples: list[Sample], points: list[tuple[int, float]]) -> list[dict]:
    """Simplified (t, x) keyframes in source time. Cuts become two keyframes 1 ms apart."""
    segments: list[list[tuple[float, float]]] = [[]]
    prev_x = None
    for i, x in points:
        t = samples[i].t
        if prev_x is not None and abs(x - prev_x) > CUT_DISTANCE:
            segments.append([])
        segments[-1].append((t, x))
        prev_x = x
    out: list[dict] = []
    for seg in segments:
        simplified = _rdp(seg, RDP_EPSILON)
        if out and simplified:
            out.append({"t": round(simplified[0][0] - 0.001, 3), "x": out[-1]["x"]})  # hold until the cut
        out += [{"t": round(t, 3), "x": round(float(x), 4)} for t, x in simplified]
    return out


BOTH_ACTIVE = 0.06       # jaw activity above which a face counts as talking
RAPID_SWITCHES = 15      # speaker switches per minute (turns under ~4 s) that make split-screen the better choice


def recommend(samples: list[Sample], tracks: list[Track], src_aspect: float, out_aspect: float, switches: int = 0) -> dict:
    """Pick a framing mode for the clip and summarise what was seen."""
    n = max(1, len(samples))
    with_face = sum(1 for s in samples if s.faces) / n
    crop_width = min(1.0, out_aspect / src_aspect)  # visible fraction of the source width when cropping
    pairs = []
    for s in samples:
        if len(s.faces) >= 2:
            two = sorted(s.faces, key=lambda f: -f.w * f.h)[:2]
            xs = sorted(f.cx for f in two)
            pairs.append(xs)
    two_apart = [p for p in pairs if p[1] - p[0] > crop_width * 0.9]
    speakers = sum(1 for t in tracks if len(t.xs) > n * 0.15)
    if abs(src_aspect / out_aspect - 1) < 0.1:
        return {"mode": "center", "faces": speakers, "split_x": None, "reason": "The video already has the output's shape, so nothing is cropped."}
    if with_face < 0.3:
        return {"mode": "blur", "faces": 0, "split_x": None, "reason": "No faces found, so the whole frame is kept on a blurred background."}
    # Split-screen only when cutting between speakers would be frantic: both talking at once,
    # or rapid back-and-forth. Calm turn-taking is better served by cutting to whoever talks.
    both_active = 0
    for i in range(n):
        acts = sorted((_activity(t, i) for t in tracks if i in t.xs), reverse=True)
        if len(acts) >= 2 and acts[1] > BOTH_ACTIVE:
            both_active += 1
    per_min = switches / max(1 / 60, n / SAMPLE_FPS / 60)
    if len(two_apart) > n * 0.6 and (both_active > n * 0.4 or per_min > RAPID_SWITCHES):
        left = float(np.median([p[0] for p in two_apart]))
        right = float(np.median([p[1] for p in two_apart]))
        return {"mode": "split", "faces": 2, "split_x": [round(left, 4), round(right, 4)],
                "reason": "Two people on screen too far apart for one crop, so they're stacked split-screen."}
    return {"mode": "track", "faces": max(1, speakers), "split_x": None,
            "reason": f"Following the active speaker ({switches} switch{'es' if switches != 1 else ''})." if speakers > 1 else "Following the speaker's face."}
