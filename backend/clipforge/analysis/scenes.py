"""Scene cuts and visual motion with PySceneDetect (ContentDetector)."""
from __future__ import annotations

import logging
import threading
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np

from .. import cache

log = logging.getLogger(__name__)


class VisualUnavailable(Exception):
    pass


@dataclass
class VisualInfo:
    cuts: list[float]       # cut times in seconds
    motion: list[float]     # mean frame difference per second (ContentDetector content_val)

    def cuts_in(self, start: float, end: float) -> int:
        return sum(start < c < end for c in self.cuts)

    def motion_in(self, start: float, end: float) -> float:
        seg = self.motion[int(start) : max(int(start) + 1, int(end))]
        return float(np.mean(seg)) if seg else 0.0


def analyze(media: Path, on_progress: Callable[[float], None], cancelled: Callable[[], bool]) -> VisualInfo:
    path = cache.cache_file("scenes", media, "v1")
    if (hit := cache.load(path)) is not None:
        return VisualInfo(**hit)

    from scenedetect import ContentDetector, SceneManager, StatsManager, VideoOpenFailure, open_video

    try:
        video = open_video(str(media))
    except VideoOpenFailure as e:
        raise VisualUnavailable(f"Could not open the video for scene detection: {e}") from e
    fps = float(video.frame_rate)
    total = video.duration.get_seconds() if video.duration else 0.0

    stats = StatsManager()
    manager = SceneManager(stats)
    manager.auto_downscale = False
    manager.downscale = max(1, video.frame_size[1] // 270)  # analyse at ~270p: fast and plenty for cuts
    manager.add_detector(ContentDetector())

    # detect_scenes blocks; report progress and honour cancellation from a side thread.
    done = threading.Event()

    def watch() -> None:
        while not done.wait(0.5):
            if cancelled():
                manager.stop()
            if total:
                on_progress(min(1.0, video.position.get_seconds() / total))

    threading.Thread(target=watch, daemon=True).start()
    try:
        frames = manager.detect_scenes(video)
    finally:
        done.set()
    if cancelled():
        raise InterruptedError()

    cuts = [s[0].get_seconds() for s in manager.get_scene_list()[1:]]
    per_frame = [stats.get_metrics(i, ["content_val"])[0] for i in range(frames)]
    vals = np.asarray([v if v is not None else 0.0 for v in per_frame], dtype=np.float32)
    per_sec = int(round(fps)) or 30
    motion = [round(float(vals[i : i + per_sec].mean()), 3) for i in range(0, len(vals), per_sec)] if vals.size else []

    info = VisualInfo(cuts=[round(c, 3) for c in cuts], motion=motion)
    cache.save(path, {"cuts": info.cuts, "motion": info.motion})
    log.info("Scenes: %d cuts over %.0fs, mean motion %.1f", len(cuts), total, float(vals.mean()) if vals.size else 0)
    return info


def features(info: VisualInfo, start: float, end: float) -> dict[str, float]:
    """0..1 features: cut rate (~6 cuts/min saturates) and on-screen motion."""
    dur = max(1.0, end - start)
    return {
        "cuts": min(1.0, info.cuts_in(start, end) * 60 / dur / 6),
        "motion": min(1.0, info.motion_in(start, end) / 12),  # content_val ~12 is lively
    }
