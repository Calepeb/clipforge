"""FastAPI sidecar. Started by Electron on 127.0.0.1 with a random port and a per-launch token.

Run standalone for debugging:
    python -m clipforge.main --port 8765 --token dev

Electron passes the token via the CLIPFORGE_TOKEN environment variable instead (not visible in process lists).
"""
from __future__ import annotations

import argparse
import asyncio
import hmac
import logging
import os
import sys
import threading
import time
from contextlib import asynccontextmanager
from pathlib import Path

import uvicorn
from fastapi import FastAPI, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, Field

from .config import settings, setup_logging
from .jobs import JobCancelled, JobContext, JobManager, UserFacingError

log = logging.getLogger("clipforge")
TOKEN = ""
jobs = JobManager()


@asynccontextmanager
async def lifespan(_app: FastAPI):
    jobs.bind_loop(asyncio.get_running_loop())
    threading.Thread(target=_warm_fonts, name="font-warmup", daemon=True).start()
    yield


def _warm_fonts() -> None:
    """Build the libass font instances ahead of the first render (one-time, ~40 s)."""
    from .captions import fonts

    try:
        fonts.prepare()
    except Exception:  # noqa: BLE001 - render jobs report font problems properly
        log.exception("Font preparation failed")


app = FastAPI(title="ClipForge backend", lifespan=lifespan)


@app.middleware("http")
async def require_token(request: Request, call_next):
    if request.url.path != "/health" and not hmac.compare_digest(request.headers.get("x-clipforge-token", ""), TOKEN):
        return JSONResponse({"detail": "Unauthorized"}, status_code=401)
    return await call_next(request)


# The renderer runs on the Vite dev server (http://localhost:5173) or from file:// (origin "null"),
# so its requests are cross-origin. Added after the token check so it wraps it and answers
# CORS preflights (which carry no token) itself.
app.add_middleware(
    CORSMiddleware,
    allow_origin_regex=r"^(http://localhost:\d+|null)$",
    allow_methods=["GET", "POST"],
    allow_headers=["content-type", "x-clipforge-token"],
)


@app.get("/health")
def health() -> dict:
    return {"ok": True, "claude": bool(settings.anthropic_api_key), "model": settings.claude_model}


class GenerateRequest(BaseModel):
    path: str
    count: int = Field(8, ge=6, le=12)
    min_len: float = Field(15, ge=5, le=120)
    max_len: float = Field(90, ge=10, le=180)


@app.post("/jobs/generate-clips")
def generate_clips(req: GenerateRequest) -> dict:
    media = Path(req.path)
    if not media.is_file():
        raise HTTPException(404, f"Video not found: {req.path}")
    if req.min_len >= req.max_len:
        raise HTTPException(400, "min_len must be shorter than max_len")
    job = jobs.start("generate-clips", f"Find clips · {media.name}", lambda ctx: _generate(ctx, media, req))
    return job.public()


def _media_duration(media: Path) -> float:
    import av

    try:
        with av.open(str(media)) as f:
            return (f.duration or 0) / 1_000_000
    except Exception:  # noqa: BLE001 - only used for progress estimates
        return 0.0


def _generate(ctx: JobContext, media: Path, req: GenerateRequest) -> dict:
    # Imports here so the server starts fast; the ML stack loads on first use.
    from concurrent.futures import ThreadPoolExecutor

    from .analysis import audio, llm, scenes
    from .analysis.scoring import to_percent
    from .analysis.selection import NotEnoughSpeech, explain, pick_clips
    from .analysis.text import split_sentences
    from .hooks import ClipCopy, write_copy
    from .transcription import Cancelled, transcribe

    warnings: list[str] = []
    duration = _media_duration(media)
    side = {"audio": 0.0, "scenes": 0.0}

    def side_progress(key: str):
        return lambda f: side.__setitem__(key, f)

    # Audio energy and scene detection run on the CPU while Whisper uses the GPU.
    with ThreadPoolExecutor(max_workers=2, thread_name_prefix="analysis") as pool:
        audio_future = pool.submit(audio.analyze, media, duration, side_progress("audio"), ctx.cancelled)
        scenes_future = pool.submit(scenes.analyze, media, side_progress("scenes"), ctx.cancelled)
        try:
            t = transcribe(media, lambda f, stage: ctx.progress(0.55 * f, f"{stage} · analysing audio & scenes"), ctx.cancelled)
        except Cancelled as e:
            raise JobCancelled() from e
        except RuntimeError as e:
            # faster-whisper/PyAV raise RuntimeError for unreadable or audio-less files.
            raise UserFacingError(f"Couldn't read the audio in {media.name}: {e}") from e

        ctx.progress(0.55, "Analysing audio & scenes")
        energy = visual = None
        for name, fut in (("audio", audio_future), ("scenes", scenes_future)):
            try:
                result = fut.result()
                if name == "audio":
                    energy = result
                else:
                    visual = result
            except InterruptedError as e:
                raise JobCancelled() from e
            except (audio.AudioUnavailable, scenes.VisualUnavailable) as e:
                warnings.append(str(e))
            except Exception:  # noqa: BLE001 - a broken signal shouldn't sink the whole job
                log.exception("%s analysis failed", name)
                warnings.append(f"{name.capitalize()} analysis failed, so it was left out of the scores.")

    sents = split_sentences(t.words)
    if not sents:
        raise UserFacingError("No speech was detected in this video.")

    ctx.progress(0.6, "Claude is reading the transcript")
    try:
        moments, llm_warning = llm.find_moments(
            sents, req.count, req.min_len, req.max_len, t.language,
            lambda f: ctx.progress(0.6 + 0.3 * f, "Claude is reading the transcript"), ctx.cancelled,
        )
    except InterruptedError as e:
        raise JobCancelled() from e
    if llm_warning:
        warnings.append(llm_warning)

    ctx.progress(0.9, "Scoring moments")
    try:
        picks, note = pick_clips(sents, moments, req.count, req.min_len, req.max_len, energy, visual, claude_used=bool(moments))
    except NotEnoughSpeech as e:
        raise UserFacingError(str(e)) from e

    # Clips that match a Claude moment use its copy; the rest get copy written now.
    copies: list[ClipCopy | None] = [
        ClipCopy(index=i, hook=p.moment.hook_text, title=p.moment.title, reason=p.moment.reason, hashtags=p.moment.hashtags)
        if p.moment else None
        for i, p in enumerate(picks)
    ]
    missing = [i for i, c in enumerate(copies) if c is None]
    if missing:
        ctx.progress(0.94, "Writing hooks & titles")
        written, copy_warning = write_copy([picks[i] for i in missing], t.language)
        for i, c in zip(missing, written):
            copies[i] = c
        if copy_warning and not llm_warning:
            warnings.append(copy_warning)

    clips = []
    for p, c in zip(picks, copies):
        assert c is not None
        highlights = explain(p)
        clips.append({
            "start": p.start,
            "end": p.end,
            "score": to_percent(p.score),
            "signals": {k: (None if v is None else round(100 * v)) for k, v in p.signals.items()},
            "title": c.title,
            "hook": c.hook,
            "reason": c.reason + (f" ({', '.join(highlights)})" if highlights else ""),
            "hashtags": c.hashtags,
            "words": [{"text": w.text, "start": w.start, "end": w.end} for w in p.words],
        })
    return {
        "language": t.language,
        "device": t.device,
        "model": t.model,
        "note": note,
        "warning": " ".join(dict.fromkeys(warnings)) or None,
        "claude": bool(moments),
        "clips": clips,
        # Full transcript (source time) so the editor can reveal captions when a clip is extended.
        "transcript": [{"text": w.text, "start": w.start, "end": w.end} for w in t.words],
    }


@app.post("/jobs/render-clip")
def render_clip(spec: dict) -> dict:
    from .render.clip import RenderSpec

    try:
        parsed = RenderSpec.model_validate(spec)
    except ValueError as e:
        raise HTTPException(422, f"Invalid render request: {e}") from e
    if not Path(parsed.media_path).is_file():
        raise HTTPException(404, f"Video not found: {parsed.media_path}")
    label = Path(parsed.output_path).name if parsed.output_path else "Render check"
    return jobs.start("render-clip", label, lambda ctx: _render(ctx, parsed)).public()


def _render(ctx: JobContext, spec) -> dict:
    from .captions.fonts import FontsMissing
    from .render import clip, ffmpeg

    try:
        return clip.render(spec, ctx.progress, ctx.cancelled)
    except ffmpeg.FfmpegCancelled as e:
        raise JobCancelled() from e
    except (ffmpeg.FfmpegError, FontsMissing, FileNotFoundError) as e:
        raise UserFacingError(str(e)) from e


class ReframeClip(BaseModel):
    id: str
    ranges: list[tuple[float, float]] = Field(min_length=1)


class ReframeRequest(BaseModel):
    path: str
    source_width: int = Field(gt=0)
    source_height: int = Field(gt=0)
    aspect: str = "9:16"
    clips: list[ReframeClip] = Field(min_length=1)


@app.post("/jobs/reframe")
def reframe(req: ReframeRequest) -> dict:
    media = Path(req.path)
    if not media.is_file():
        raise HTTPException(404, f"Video not found: {req.path}")
    label = f"Auto-reframe · {len(req.clips)} clip{'s' if len(req.clips) > 1 else ''}"
    return jobs.start("reframe", label, lambda ctx: _reframe(ctx, media, req)).public()


def _reframe(ctx: JobContext, media: Path, req: ReframeRequest) -> dict:
    from .reframe import ReframeUnavailable, analyze_clip
    from .reframe.faces import SAMPLE_FPS

    out_aspect = {"9:16": 9 / 16, "1:1": 1.0, "16:9": 16 / 9}.get(req.aspect, 9 / 16)
    total = max(1, sum(int((b - a) * SAMPLE_FPS) for c in req.clips for a, b in c.ranges))
    done = [0]

    def on_frame() -> None:
        done[0] += 1
        ctx.progress(done[0] / total, "Tracking faces")

    results = {}
    try:
        for c in req.clips:
            results[c.id] = analyze_clip(media, c.ranges, req.source_width, req.source_height, out_aspect, on_frame, ctx.cancelled)
    except InterruptedError as e:
        raise JobCancelled() from e
    except ReframeUnavailable as e:
        raise UserFacingError(str(e)) from e
    return {"clips": results}


class FontInspect(BaseModel):
    path: str


@app.post("/fonts/inspect")
def inspect_font(req: FontInspect) -> dict:
    from .captions.fonts import family_of

    try:
        return {"family": family_of(Path(req.path))}
    except Exception as e:  # noqa: BLE001 - any unreadable font file
        raise HTTPException(400, f"Not a usable font file: {e}") from e


@app.get("/system")
def system() -> dict:
    """What the Settings dialog shows: GPU, CUDA libraries, Claude key."""
    from . import gpu

    return {
        "gpu": gpu.nvidia_gpu(),
        "cuda_libs": gpu.libs_present(),
        "claude_key": bool(settings.anthropic_api_key),
        "frozen": bool(getattr(sys, "frozen", False)),
    }


@app.post("/jobs/install-gpu")
def install_gpu() -> dict:
    from . import gpu

    def run(ctx: JobContext) -> dict:
        try:
            return gpu.install(ctx.progress, ctx.cancelled)
        except InterruptedError as e:
            raise JobCancelled() from e
        except gpu.GpuInstallError as e:
            raise UserFacingError(str(e)) from e

    return jobs.start("install-gpu", "Enable GPU acceleration", run).public()


@app.get("/jobs/{job_id}")
def get_job(job_id: str) -> dict:
    job = jobs.jobs.get(job_id)
    if not job:
        raise HTTPException(404, "No such job")
    return job.public()


@app.post("/jobs/{job_id}/cancel")
def cancel_job(job_id: str) -> dict:
    return {"cancelled": jobs.cancel(job_id)}


@app.websocket("/ws")
async def ws(socket: WebSocket) -> None:
    # Browsers can't set headers on WebSockets, so the token comes as a query param.
    if not hmac.compare_digest(socket.query_params.get("token", ""), TOKEN):
        await socket.close(code=4401)
        return
    await socket.accept()
    q = jobs.subscribe()
    try:
        for job in jobs.jobs.values():
            await socket.send_json({"type": "job", "job": job.public()})
        while True:
            await socket.send_json(await q.get())
    except WebSocketDisconnect:
        pass
    finally:
        jobs.unsubscribe(q)


def _pid_alive(pid: int) -> bool:
    if sys.platform == "win32":
        import ctypes

        kernel32 = ctypes.windll.kernel32
        handle = kernel32.OpenProcess(0x00100000, False, pid)  # SYNCHRONIZE
        if not handle:
            return False
        try:
            return kernel32.WaitForSingleObject(handle, 0) == 0x102  # WAIT_TIMEOUT = still running
        finally:
            kernel32.CloseHandle(handle)
    try:
        os.kill(pid, 0)
    except ProcessLookupError:
        return False
    except PermissionError:
        return True
    return True


def _exit_with_parent(pid: int) -> None:
    """Shut down if Electron goes away without stopping us (crash, hot restart).

    Polls the parent PID rather than blocking on stdin: on Windows a pending stdin read
    can stall other threads that touch the process's handles (e.g. starting subprocesses).
    """
    def watch() -> None:
        while _pid_alive(pid):
            time.sleep(2)
        log.info("Parent process %d gone; exiting", pid)
        os._exit(0)

    threading.Thread(target=watch, name="parent-watch", daemon=True).start()


def main() -> None:
    global TOKEN
    parser = argparse.ArgumentParser()
    parser.add_argument("--port", type=int, required=True)
    parser.add_argument("--token", default=os.environ.get("CLIPFORGE_TOKEN"))
    args = parser.parse_args()
    if not args.token:
        parser.error("--token or CLIPFORGE_TOKEN is required")
    TOKEN = args.token
    setup_logging()
    if parent := os.environ.get("CLIPFORGE_PARENT_PID"):
        _exit_with_parent(int(parent))
    log.info("Backend starting on 127.0.0.1:%d (Claude key %s)", args.port, "found" if settings.anthropic_api_key else "missing")
    uvicorn.run(app, host="127.0.0.1", port=args.port, log_level="warning")


if __name__ == "__main__":
    main()
