"""Audio energy: loudness per half-second and spikes relative to the speaker's baseline.

Spikes catch reactions, laughter, raised voices and applause. (There is no dedicated
laughter classifier; loud, sudden bursts are treated as engagement signals.)
"""
from __future__ import annotations

import logging
import shutil
import subprocess
from dataclasses import dataclass
from pathlib import Path
from typing import Callable

import numpy as np

from .. import cache

log = logging.getLogger(__name__)

RATE = 8000          # Hz; plenty for loudness
HOP = 0.5            # seconds per energy window
SPIKE_Z = 1.8        # z-score above baseline that counts as a spike


class AudioUnavailable(Exception):
    pass


@dataclass
class AudioEnergy:
    hop: float
    z: list[float]   # loudness z-score per window (0 for silence)

    def window(self, start: float, end: float) -> np.ndarray:
        a, b = int(start / self.hop), max(int(start / self.hop) + 1, int(end / self.hop))
        return np.asarray(self.z[a:b], dtype=np.float32)


def analyze(media: Path, duration: float, on_progress: Callable[[float], None], cancelled: Callable[[], bool]) -> AudioEnergy:
    path = cache.cache_file("audio", media, f"v1|{RATE}|{HOP}")
    if (hit := cache.load(path)) is not None:
        return AudioEnergy(**hit)
    if not shutil.which("ffmpeg"):
        raise AudioUnavailable("FFmpeg was not found on PATH, so audio energy was skipped.")

    cmd = ["ffmpeg", "-v", "error", "-nostdin", "-i", str(media), "-vn", "-ac", "1", "-ar", str(RATE), "-f", "f32le", "-"]
    block = int(RATE * HOP)
    rms: list[float] = []
    proc = subprocess.Popen(cmd, stdout=subprocess.PIPE, stderr=subprocess.PIPE, creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0))
    try:
        assert proc.stdout
        while chunk := proc.stdout.read(block * 4):
            if cancelled():
                proc.kill()
                raise InterruptedError()
            samples = np.frombuffer(chunk[: len(chunk) // 4 * 4], dtype=np.float32)
            rms.append(float(np.sqrt(np.mean(samples**2))) if samples.size else 0.0)
            if duration and len(rms) % 40 == 0:
                on_progress(min(1.0, len(rms) * HOP / duration))
        proc.wait(timeout=30)
    finally:
        if proc.poll() is None:
            proc.kill()
    if proc.returncode not in (0, None) or not rms:
        err = proc.stderr.read().decode(errors="replace")[-500:] if proc.stderr else ""
        log.error("ffmpeg audio decode failed (code %s): %s", proc.returncode, err)
        raise AudioUnavailable("Could not decode the audio track, so audio energy was skipped.")

    db = 20 * np.log10(np.maximum(np.asarray(rms), 1e-6))
    active = db > -45  # ignore silence when estimating the baseline
    if active.sum() < 10:
        z = np.zeros_like(db)
    else:
        med = float(np.median(db[active]))
        mad = float(np.median(np.abs(db[active] - med))) * 1.4826 or 1.0
        z = np.where(active, (db - med) / mad, 0.0)
    result = AudioEnergy(hop=HOP, z=[round(float(v), 3) for v in z])
    cache.save(path, {"hop": result.hop, "z": result.z})
    log.info("Audio energy: %d windows, %d spikes", len(z), int((z > SPIKE_Z).sum()))
    return result


def features(energy: AudioEnergy, start: float, end: float) -> dict[str, float]:
    """0..1 features: overall liveliness, spike rate, and a loud opening (hook energy)."""
    w = energy.window(start, end)
    if w.size == 0:
        return {"liveliness": 0.0, "spikes": 0.0, "opening": 0.0}
    opening = energy.window(start, start + 3)
    spikes_per_10s = float((w > SPIKE_Z).sum()) / max(1.0, (end - start) / 10)
    return {
        "liveliness": min(1.0, float(np.mean(np.clip(w, 0, 3))) / 1.5),
        "spikes": min(1.0, spikes_per_10s / 1.5),
        "opening": float(np.clip(opening.max(), 0, 3)) / 3 if opening.size else 0.0,
    }
