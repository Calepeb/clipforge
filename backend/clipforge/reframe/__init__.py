"""Auto-reframe: face tracking, active-speaker selection and a smooth crop path."""
from __future__ import annotations

import logging
from dataclasses import asdict
from pathlib import Path
from typing import Callable

from .. import cache
from .faces import SAMPLE_FPS, Face, ReframeUnavailable, Sample, detect
from . import path as camera_path

log = logging.getLogger(__name__)

__all__ = ["analyze_clip", "ReframeUnavailable"]


def _samples(media: Path, a: float, b: float, w: int, h: int, on_frame: Callable[[], None], cancelled: Callable[[], bool]) -> list[Sample]:
    file = cache.cache_file("faces", media, f"v1|{a:.2f}|{b:.2f}")
    if (hit := cache.load(file)) is not None:
        for _ in range(int((b - a) * SAMPLE_FPS)):
            on_frame()
        return [Sample(t=s["t"], faces=[Face(**f) for f in s["faces"]]) for s in hit]
    samples = detect(media, a, b, w, h, on_frame, cancelled)
    cache.save(file, [{"t": s.t, "faces": [asdict(f) for f in s.faces]} for s in samples])
    return samples


def analyze_clip(
    media: Path, ranges: list[tuple[float, float]], src_w: int, src_h: int, out_aspect: float,
    on_frame: Callable[[], None], cancelled: Callable[[], bool],
) -> dict:
    """Face-track the clip's source ranges and return a framing recommendation + camera keyframes."""
    samples: list[Sample] = []
    for a, b in sorted(ranges):
        samples += _samples(media, a, b, src_w, src_h, on_frame, cancelled)
    if not samples:
        return {"mode": "center", "keyframes": [], "split_x": None, "faces": 0, "reason": "Nothing to analyse."}
    tracks = camera_path.build_tracks(samples)
    points = camera_path.camera(camera_path.speaker_path(samples, tracks))
    xs = [x for _, x in points]
    switches = sum(1 for p, q in zip(xs, xs[1:]) if abs(q - p) > camera_path.CUT_DISTANCE)
    rec = camera_path.recommend(samples, tracks, src_w / src_h, out_aspect, switches)
    keyframes = camera_path.keyframes(samples, points) if rec["mode"] == "track" else []
    log.info("Reframe %s %.0f-%.0fs: %s, %d keyframes", media.name, ranges[0][0], ranges[-1][1], rec["mode"], len(keyframes))
    return {**rec, "keyframes": keyframes}
