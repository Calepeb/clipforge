"""Running FFmpeg: progress parsing, cancellation, error reporting, encoder selection."""
from __future__ import annotations

import logging
import shutil
import subprocess
import sys
import threading
from collections import deque
from pathlib import Path
from typing import Callable

log = logging.getLogger(__name__)
NO_WINDOW = getattr(subprocess, "CREATE_NO_WINDOW", 0)


class FfmpegError(Exception):
    pass


class FfmpegCancelled(Exception):
    pass


def require_ffmpeg() -> str:
    exe = shutil.which("ffmpeg")
    if not exe:
        raise FfmpegError("FFmpeg was not found on PATH. Install it (see README) and restart ClipForge.")
    return exe


# What TikTok/Reels/Shorts ingest best: H.264 High@4.2, 2 s keyframe interval, capped bitrate.
PLATFORM_ARGS = ["-profile:v", "high", "-level:v", "4.2", "-g", "60", "-maxrate", "15M", "-bufsize", "30M"]

_encoder: list[str] | None = None
_encoder_lock = threading.Lock()


def video_encoder() -> list[str]:
    """Fastest encoder that actually works here (probed once): NVIDIA NVENC, Apple
    VideoToolbox, then libx264 on the CPU."""
    global _encoder
    with _encoder_lock:
        if _encoder is None:
            candidates: list[tuple[str, list[str]]] = []
            if sys.platform == "darwin":
                candidates.append(("VideoToolbox", ["-c:v", "h264_videotoolbox", "-b:v", "10M", "-profile:v", "high", "-g", "60", "-maxrate", "15M", "-bufsize", "30M"]))
            else:
                candidates.append(("NVENC", ["-c:v", "h264_nvenc", "-preset", "p5", "-tune", "hq", "-rc", "vbr", "-cq", "20", "-b:v", "0", *PLATFORM_ARGS]))
            for name, args in candidates:
                probe = subprocess.run(
                    [require_ffmpeg(), "-v", "error", "-f", "lavfi", "-i", "color=black:s=256x256:d=0.1", "-pix_fmt", "yuv420p", *args, "-f", "null", "-"],
                    capture_output=True, creationflags=NO_WINDOW,
                )
                if probe.returncode == 0:
                    _encoder = args
                    log.info("Using %s hardware encoder", name)
                    break
            else:
                _encoder = ["-c:v", "libx264", "-preset", "veryfast", "-crf", "20", *PLATFORM_ARGS]
                log.info("No hardware encoder available, using libx264")
        return _encoder


def run(args: list[str], cwd: Path, duration: float, on_progress: Callable[[float], None], cancelled: Callable[[], bool]) -> None:
    """Run ffmpeg with -progress parsing. Raises FfmpegError with the useful tail of stderr."""
    cmd = [require_ffmpeg(), "-hide_banner", "-nostdin", "-y", "-progress", "pipe:1", "-nostats", *args]
    log.info("ffmpeg %s", " ".join(args[-6:]))
    proc = subprocess.Popen(cmd, cwd=cwd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True, encoding="utf-8", errors="replace", creationflags=NO_WINDOW)
    tail: deque[str] = deque(maxlen=40)
    reader = threading.Thread(target=lambda: tail.extend(proc.stderr or []), daemon=True)
    reader.start()
    try:
        assert proc.stdout
        for line in proc.stdout:
            if cancelled():
                proc.kill()
                raise FfmpegCancelled()
            if line.startswith("out_time_us=") and duration > 0:
                try:
                    on_progress(min(1.0, int(line.split("=")[1]) / 1e6 / duration))
                except ValueError:
                    pass  # "N/A" before the first frame
        proc.wait()
    finally:
        if proc.poll() is None:
            proc.kill()
        reader.join(timeout=2)
    if proc.returncode != 0:
        detail = "\n".join(l.rstrip() for l in tail)
        log.error("ffmpeg failed (code %s):\n%s", proc.returncode, detail)
        last = next((l.strip() for l in reversed(tail) if l.strip()), "unknown error")
        raise FfmpegError(f"FFmpeg failed: {last}")
