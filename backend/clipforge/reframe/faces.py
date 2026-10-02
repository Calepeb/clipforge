"""Face detection with MediaPipe Face Landmarker on frames sampled by FFmpeg.

Each face gives a box (from its landmarks) and a `jawOpen` blendshape score, which is
what active-speaker detection uses: a talking mouth keeps opening and closing.
"""
from __future__ import annotations

import logging
import shutil
import subprocess
import urllib.request
from dataclasses import dataclass
from pathlib import Path
from typing import Callable, Iterator

import numpy as np

from ..config import settings

log = logging.getLogger(__name__)

MODEL_URL = "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task"
SAMPLE_FPS = 5
SAMPLE_WIDTH = 640
MAX_FACES = 4
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


class ReframeUnavailable(Exception):
    pass


@dataclass
class Face:
    cx: float   # 0..1 of source width
    cy: float
    w: float
    h: float
    jaw: float  # 0..1 mouth openness


@dataclass
class Sample:
    t: float            # source seconds
    faces: list[Face]


def model_path() -> Path:
    """The Face Landmarker model, downloaded once from Google's model storage (~4 MB)."""
    path = settings.cache_dir / "models" / "face_landmarker.task"
    if path.exists():
        return path
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(".part")
    log.info("Downloading face model from %s", MODEL_URL)
    try:
        with urllib.request.urlopen(MODEL_URL, timeout=60) as r, tmp.open("wb") as f:
            shutil.copyfileobj(r, f)
        tmp.replace(path)
    except Exception as e:  # noqa: BLE001
        tmp.unlink(missing_ok=True)
        raise ReframeUnavailable(f"Couldn't download the face-tracking model ({e}). Check your connection and retry.") from e
    return path


def _frames(media: Path, start: float, end: float, src_w: int, src_h: int) -> Iterator[tuple[float, np.ndarray]]:
    """RGB frames at SAMPLE_FPS between start and end (source seconds), downscaled."""
    if not shutil.which("ffmpeg"):
        raise ReframeUnavailable("FFmpeg was not found on PATH.")
    w = SAMPLE_WIDTH
    h = int(round(src_h * w / src_w / 2)) * 2
    cmd = [
        "ffmpeg", "-v", "error", "-nostdin", "-ss", f"{start:.3f}", "-t", f"{max(0.2, end - start):.3f}", "-i", str(media),
        "-an", "-vf", f"fps={SAMPLE_FPS},scale={w}:{h}", "-f", "rawvideo", "-pix_fmt", "rgb24", "-",
    ]
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=NO_WINDOW)
    size = w * h * 3
    i = 0
    try:
        assert proc.stdout
        while chunk := proc.stdout.read(size):
            if len(chunk) < size:
                break
            yield start + i / SAMPLE_FPS, np.frombuffer(chunk, np.uint8).reshape(h, w, 3)
            i += 1
    finally:
        if proc.poll() is None:
            proc.kill()
        proc.wait()


def detect(
    media: Path, start: float, end: float, src_w: int, src_h: int,
    on_frame: Callable[[], None], cancelled: Callable[[], bool],
) -> list[Sample]:
    import mediapipe as mp
    from mediapipe.tasks.python import BaseOptions, vision

    options = vision.FaceLandmarkerOptions(
        base_options=BaseOptions(model_asset_path=str(model_path())),
        running_mode=vision.RunningMode.VIDEO,
        num_faces=MAX_FACES,
        output_face_blendshapes=True,
        min_face_detection_confidence=0.5,
    )
    samples: list[Sample] = []
    with vision.FaceLandmarker.create_from_options(options) as landmarker:
        for t, rgb in _frames(media, start, end, src_w, src_h):
            if cancelled():
                raise InterruptedError()
            image = mp.Image(image_format=mp.ImageFormat.SRGB, data=np.ascontiguousarray(rgb))
            result = landmarker.detect_for_video(image, int(round((t - start) * 1000)))
            faces = []
            for i, lms in enumerate(result.face_landmarks):
                xs = [p.x for p in lms]
                ys = [p.y for p in lms]
                jaw = 0.0
                if result.face_blendshapes and i < len(result.face_blendshapes):
                    jaw = next((c.score for c in result.face_blendshapes[i] if c.category_name == "jawOpen"), 0.0)
                x0, x1, y0, y1 = max(0, min(xs)), min(1, max(xs)), max(0, min(ys)), min(1, max(ys))
                faces.append(Face(cx=(x0 + x1) / 2, cy=(y0 + y1) / 2, w=x1 - x0, h=y1 - y0, jaw=float(jaw)))
            samples.append(Sample(t=t, faces=faces))
            on_frame()
    return samples
