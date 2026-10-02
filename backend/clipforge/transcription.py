"""Speech-to-text with word timestamps via faster-whisper. GPU when usable, CPU otherwise."""
from __future__ import annotations

import hashlib
import json
import logging
import os
import sys
import threading
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Callable

from .config import settings

log = logging.getLogger(__name__)


class Cancelled(Exception):
    pass


@dataclass
class Word:
    text: str
    start: float
    end: float


@dataclass
class Transcript:
    language: str
    duration: float
    model: str
    device: str
    words: list[Word]


def _add_cuda_dll_dirs() -> None:
    """On Windows, CUDA DLLs come from pip (development) or the in-app download (installed app)."""
    if sys.platform != "win32":
        return
    from .gpu import dll_dirs

    for d in dll_dirs():
        os.add_dll_directory(str(d))
        os.environ["PATH"] = f"{d}{os.pathsep}{os.environ['PATH']}"


def _cuda_usable() -> bool:
    """Only pick CUDA when a GPU exists AND the cuBLAS/cuDNN libraries are present.
    A missing cuDNN makes CTranslate2 abort the process instead of raising."""
    if settings.whisper_device == "cpu":
        return False
    try:
        import ctranslate2

        if ctranslate2.get_cuda_device_count() < 1:
            return False
    except Exception:  # noqa: BLE001 - any import/driver problem means "no GPU"
        log.exception("CUDA probe failed")
        return False
    if sys.platform == "win32":
        from .gpu import libs_present

        if not libs_present():
            log.warning("NVIDIA GPU found but cuBLAS/cuDNN libraries are missing; using CPU. Enable GPU acceleration in Settings (or run `npm run setup:backend`).")
            return False
    return True


_model = None
_model_info: tuple[str, str] = ("", "")
_model_lock = threading.Lock()


def load_model():
    """Load (once) the Whisper model. Returns (model, name, device)."""
    global _model, _model_info
    with _model_lock:
        if _model is not None:
            return _model, *_model_info
        from faster_whisper import WhisperModel

        _add_cuda_dll_dirs()
        if _cuda_usable():
            name = settings.whisper_model or "medium"
            try:
                _model = WhisperModel(name, device="cuda", compute_type="int8_float16")
                _model_info = (name, "cuda")
                log.info("Loaded Whisper %s on GPU", name)
                return _model, *_model_info
            except Exception:  # noqa: BLE001
                log.exception("GPU model load failed; falling back to CPU")
        name = settings.whisper_model or "small"
        _model = WhisperModel(name, device="cpu", compute_type="int8")
        _model_info = (name, "cpu")
        log.info("Loaded Whisper %s on CPU", name)
        return _model, *_model_info


def _cache_path(media: Path) -> Path:
    st = media.stat()
    key = f"v2|{media.resolve()}|{st.st_size}|{st.st_mtime_ns}|{settings.whisper_model}"
    d = settings.cache_dir / "transcripts"
    d.mkdir(parents=True, exist_ok=True)
    return d / f"{hashlib.sha1(key.encode()).hexdigest()}.json"


def transcribe(
    media: Path,
    on_progress: Callable[[float, str], None],
    cancelled: Callable[[], bool],
) -> Transcript:
    """Transcribe a media file. `on_progress(fraction, stage)` is called as segments arrive."""
    cache = _cache_path(media)
    if cache.exists():
        try:
            data = json.loads(cache.read_text("utf-8"))
            log.info("Transcript cache hit for %s", media.name)
            on_progress(1.0, "Using saved transcript")
            return Transcript(**{**data, "words": [Word(**w) for w in data["words"]]})
        except Exception:  # noqa: BLE001 - corrupt cache: just transcribe again
            log.exception("Ignoring unreadable transcript cache %s", cache)

    on_progress(0.0, "Loading speech model (first run downloads it)")
    model, name, device = load_model()
    on_progress(0.02, "Transcribing")
    # Whisper tends to drop "um"/"uh"; a disfluent prompt makes it keep them, which the
    # editor's filler-word removal needs. (Only biases style; it isn't transcribed.)
    segments, info = model.transcribe(
        str(media), word_timestamps=True, vad_filter=True, beam_size=5,
        initial_prompt="Umm, let me think, uh... like, hmm. Okay, so, uh, here's what I, um, think.",
    )
    log.info("Transcribing %s: language=%s (p=%.2f) duration=%.1fs", media.name, info.language, info.language_probability, info.duration)

    words: list[Word] = []
    for seg in segments:  # generator: decoding happens as we iterate
        if cancelled():
            raise Cancelled()
        for w in seg.words or []:
            text = w.word.strip()
            if text:
                words.append(Word(text=text, start=round(w.start, 3), end=round(w.end, 3)))
        if info.duration:
            on_progress(min(1.0, seg.end / info.duration), "Transcribing")

    t = Transcript(language=info.language, duration=info.duration, model=name, device=device, words=words)
    cache.write_text(json.dumps({**asdict(t)}), "utf-8")
    return t
