"""Render one edited clip: segments → framing → captions/text (ASS) → progress bar → MP4.

The framing math mirrors the preview canvas (src/features/preview/usePlayback.ts, paint()).
"""
from __future__ import annotations

import hashlib
import json
import logging
import os
import shutil
from pathlib import Path
from typing import Callable, Literal

from pydantic import BaseModel, Field

from ..captions import fonts
from ..captions.ass import AssBuilder, Word
from ..config import settings
from . import ffmpeg

log = logging.getLogger(__name__)

FPS = 30
SIZES = {"9:16": (1080, 1920), "1:1": (1080, 1080), "16:9": (1920, 1080)}


class Segment(BaseModel):
    src_start: float
    start: float
    end: float
    volume: float = 1.0


class Keyframe(BaseModel):
    t: float   # source seconds
    x: float   # subject centre, 0..1 of source width


class Framing(BaseModel):
    mode: Literal["track", "center", "blur", "split"] = "track"
    focus_x: float = 0.5
    zoom: float = 1.0
    keyframes: list[Keyframe] = []           # auto-reframe camera path (track mode)
    split_x: tuple[float, float] | None = None  # subject centres for split-screen halves


class Music(BaseModel):
    path: str
    start: float
    end: float
    volume: float = 0.35
    fade_in: float = 0.5
    fade_out: float = 1.5
    ducking: bool = True
    duck_amount: float = 0.6   # 0..1: how far the music dips under speech


class Watermark(BaseModel):
    path: str
    corner: Literal["tl", "tr", "bl", "br"] = "br"
    size: float = 0.18      # fraction of the frame width
    opacity: float = 0.85


class ColorFx(BaseModel):
    matrix: list[float] = Field(min_length=9, max_length=9)  # 3x3, row-major, sRGB 0..1
    offset: tuple[float, float, float]


class Effects(BaseModel):
    """Computed by the editor (src/lib/effects.ts) so preview and export match."""
    zoom_intervals: list[tuple[float, float]] = []  # timeline seconds
    zoom_amount: float = 1.15
    color: ColorFx | None = None
    vignette: float = 0.0        # 0..1 darkness at the corners
    fade_in: float = 0.0
    fade_out: float = 0.0
    normalize_audio: bool = False


class RenderSpec(BaseModel):
    media_path: str
    source_width: int
    source_height: int
    aspect: Literal["9:16", "1:1", "16:9"] = "9:16"
    segments: list[Segment] = Field(min_length=1)
    framing: Framing = Framing()
    words: list[dict] = []          # {text, start, end} in timeline time
    caption_style: dict | None = None
    texts: list[dict] = []          # editor TextItem objects
    progress_bar: bool = False
    music: list[Music] = []
    watermark: Watermark | None = None
    effects: Effects = Effects()
    output_path: str | None = None  # default: a cache file (render check)
    srt: str | None = None          # written next to output_path as .srt


def _even(x: float) -> int:
    return max(2, int(round(x / 2)) * 2)


def _crop_size(iw: int, ih: int, w: int, h: int, zoom: float) -> tuple[int, int]:
    s = max(w / iw, h / ih) * zoom
    return _even(min(iw, w / s)), _even(min(ih, h / s))


def _cover(iw: int, ih: int, w: int, h: int, focus: float, zoom: float, src: str, out: str, x_expr: str | None = None) -> str:
    """Crop the source region that fills w x h (like drawCover in the preview)."""
    sw, sh = _crop_size(iw, ih, w, h, zoom)
    sx = x_expr or str(int((iw - sw) * focus))
    return f"[{src}]crop={sw}:{sh}:{sx}:{int((ih - sh) / 2)},scale={w}:{h}:flags=lanczos,setsar=1[{out}]"


def _focus_for(cx: float, iw: int, sw: int) -> float:
    """Focus (0..1 crop position) that centres a subject at cx (0..1 of width)."""
    return 0.5 if iw <= sw else min(1.0, max(0.0, (cx * iw - sw / 2) / (iw - sw)))


def _path_expr(keys: list[Keyframe], seg: Segment, iw: int, sw: int) -> str | None:
    """Piecewise-linear crop x over segment-relative time t, clamped inside the frame.
    crop evaluates x every frame, so this pans/cuts exactly like the preview."""
    dur = seg.end - seg.start
    pts = [(k.t - seg.src_start, k.x * iw - sw / 2) for k in keys if -1 <= k.t - seg.src_start <= dur + 1]
    if not pts:
        return None
    expr = f"{pts[-1][1]:.1f}"
    for (t0, x0), (t1, x1) in reversed(list(zip(pts, pts[1:]))):
        slope = (x1 - x0) / (t1 - t0) if t1 > t0 else 0.0
        expr = f"if(lt(t,{t1:.3f}),{x0:.1f}+({slope:.3f})*(t-{t0:.3f}),{expr})"
    expr = f"if(lt(t,{pts[0][0]:.3f}),{pts[0][1]:.1f},{expr})"
    return f"'clip({expr},0,{iw - sw})'"


def _framing(spec: RenderSpec, seg: Segment, w: int, h: int, src: str, out: str, k: int) -> list[str]:
    iw, ih, f = spec.source_width, spec.source_height, spec.framing
    if f.mode == "blur":
        s = min(w / iw, h / ih) * f.zoom
        fw, fh = _even(iw * s), _even(ih * s)
        return [
            f"[{src}]split[bgs{k}][fgs{k}]",
            _cover(iw, ih, w, h, 0.5, 1.0, f"bgs{k}", f"bg{k}"),
            f"[bg{k}]gblur=sigma=40,eq=brightness=-0.25[bgb{k}]",
            f"[fgs{k}]scale={fw}:{fh}:flags=lanczos,setsar=1[fg{k}]",
            f"[bgb{k}][fg{k}]overlay=(W-w)/2:(H-h)/2[{out}]",
        ]
    if f.mode == "split":
        half = _even(h / 2)
        sw = _crop_size(iw, ih, w, half, f.zoom)[0]
        left, right = f.split_x or (None, None)
        top_focus = _focus_for(left, iw, sw) if left is not None else 0.15
        bottom_focus = _focus_for(right, iw, sw) if right is not None else 0.85
        return [
            f"[{src}]split[ta{k}][tb{k}]",
            _cover(iw, ih, w, half, top_focus, f.zoom, f"ta{k}", f"top{k}"),
            _cover(iw, ih, w, h - half, bottom_focus, f.zoom, f"tb{k}", f"bot{k}"),
            f"[top{k}][bot{k}]vstack,drawbox=x=0:y={half - 2}:w=iw:h=4:color=black:t=fill[{out}]",
        ]
    if f.mode == "track" and f.keyframes:
        sw = _crop_size(iw, ih, w, h, f.zoom)[0]
        return [_cover(iw, ih, w, h, 0.5, f.zoom, src, out, _path_expr(f.keyframes, seg, iw, sw))]
    focus = 0.5 if f.mode == "center" else f.focus_x
    return [_cover(iw, ih, w, h, focus, f.zoom, src, out)]


def _video_effects(spec: RenderSpec, w: int, h: int, src: str, parts: list[str], vignette_input: int | None) -> str:
    fx = spec.effects
    v = src
    if fx.zoom_intervals and fx.zoom_amount > 1.001:
        # zoompan with d=1 re-zooms every frame; `it` is the (timeline) input time.
        on = "+".join(f"between(it,{a:.3f},{b:.3f})" for a, b in fx.zoom_intervals)
        parts.append(
            f"[{v}]zoompan=z='if({on},{fx.zoom_amount:.3f},1)':x='iw/2-(iw/zoom/2)':y='ih/2-(ih/zoom/2)'"
            f":d=1:s={w}x{h}:fps={FPS}[vzoom]"
        )
        v = "vzoom"
    if fx.color:
        m, o = fx.color.matrix, fx.color.offset
        parts.append(
            f"[{v}]format=gbrp,colorchannelmixer=rr={m[0]}:rg={m[1]}:rb={m[2]}:gr={m[3]}:gg={m[4]}:gb={m[5]}:br={m[6]}:bg={m[7]}:bb={m[8]},"
            f"lutrgb=r='clip(val+{o[0] * 255:.2f},0,255)':g='clip(val+{o[1] * 255:.2f},0,255)':b='clip(val+{o[2] * 255:.2f},0,255)'[vcolor]"
        )
        v = "vcolor"
    if vignette_input is not None:
        parts.append(f"[{v}][{vignette_input}:v]overlay=0:0:shortest=1[vvig]")
        v = "vvig"
    return v


def _audio_effects(spec: RenderSpec, total: float, src: str, parts: list[str]) -> str:
    fx = spec.effects
    chain = []
    if fx.fade_in > 0:
        chain.append(f"afade=t=in:d={fx.fade_in:.3f}")
    if fx.fade_out > 0:
        chain.append(f"afade=t=out:st={max(0.0, total - fx.fade_out):.3f}:d={fx.fade_out:.3f}")
    if fx.normalize_audio:
        # Short-form platforms normalise to about -14 LUFS; doing it here avoids their limiter.
        chain.append("loudnorm=I=-14:TP=-1.5:LRA=11,aresample=48000")
    if not chain:
        return src
    parts.append(f"{src}{','.join(chain)}[afx]")
    return "[afx]"


def _vignette_png(path: Path, w: int, h: int, strength: float) -> None:
    """Same gradient as the preview's CSS: radial-gradient(ellipse at center, transparent 40%,
    rgba(0,0,0,strength) 100%), where 100% is the farthest corner."""
    import cv2
    import numpy as np

    ys, xs = np.mgrid[0:h, 0:w].astype(np.float32)
    r = np.sqrt(((xs + 0.5 - w / 2) / (w / 2)) ** 2 + ((ys + 0.5 - h / 2) / (h / 2)) ** 2) / np.sqrt(2)
    alpha = np.clip((r - 0.4) / 0.6, 0, 1) * strength
    img = np.zeros((h, w, 4), np.uint8)
    img[..., 3] = np.round(alpha * 255).astype(np.uint8)
    cv2.imwrite(str(path), img)


def _graph(spec: RenderSpec, w: int, h: int, total: float, ass_name: str | None, fonts_rel: str | None, vignette_input: int | None = None) -> tuple[str, str, str]:
    """Input i is segment i, already seeked/trimmed with -ss/-t (see render())."""
    parts: list[str] = []
    segs = sorted(spec.segments, key=lambda s: s.start)
    pieces: list[str] = []
    cursor = 0.0
    gap = 0
    for i, s in enumerate(segs):
        if s.start - cursor > 0.02:  # deleted section on the timeline → black + silence
            d = s.start - cursor
            parts.append(f"color=c=black:s={w}x{h}:r={FPS}:d={d:.3f},setsar=1[gv{gap}]")
            parts.append(f"anullsrc=r=48000:cl=stereo,atrim=0:{d:.3f}[ga{gap}]")
            pieces.append(f"[gv{gap}][ga{gap}]")
            gap += 1
        parts.append(f"[{i}:v]setpts=PTS-STARTPTS,fps={FPS}[vt{i}]")
        parts += _framing(spec, s, w, h, f"vt{i}", f"vf{i}", i)
        parts.append(
            f"[{i}:a]asetpts=PTS-STARTPTS,"
            f"aresample=48000,aformat=channel_layouts=stereo,volume={s.volume:.3f}[af{i}]"
        )
        pieces.append(f"[vf{i}][af{i}]")
        cursor = s.end
    parts.append("".join(pieces) + f"concat=n={len(pieces)}:v=1:a=1[vc][ac]")
    audio_out = _audio_effects(spec, total, _music_mix(spec, len(segs), parts), parts)

    v = _video_effects(spec, w, h, "vc", parts, vignette_input)
    if ass_name:
        parts.append(f"[{v}]ass={ass_name}:fontsdir={fonts_rel}[vs_ass]")
        v = "vs_ass"
    if spec.progress_bar:
        bar = max(4, round(h * 0.003))
        # A white strip sliding in from the left (overlay x is evaluated every frame).
        parts.append(f"color=c=white:s={w}x{bar}:r={FPS}:d={total:.3f}[barsrc]")
        parts.append(f"[{v}]drawbox=x=0:y=ih-{bar}:w=iw:h={bar}:color=white@0.2:t=fill[vtrack]")
        parts.append(f"[vtrack][barsrc]overlay=x='-W+W*t/{total:.3f}':y=H-{bar}:eof_action=pass[vbar]")
        v = "vbar"
    if spec.watermark:
        wm = spec.watermark
        idx = len(segs) + len(spec.music)  # image input follows the segment and music inputs
        ww = _even(w * wm.size)
        margin = round(w * 0.04)
        x = margin if wm.corner in ("tl", "bl") else f"W-w-{margin}"
        y = margin if wm.corner in ("tl", "tr") else f"H-h-{margin}"
        parts.append(f"[{idx}:v]scale={ww}:-1,format=rgba,colorchannelmixer=aa={wm.opacity:.2f}[wm]")
        parts.append(f"[{v}][wm]overlay=x={x}:y={y}:shortest=1[vwm]")
        v = "vwm"
    fx = spec.effects
    if fx.fade_in > 0 or fx.fade_out > 0:  # last, so captions and watermark fade too
        fades = []
        if fx.fade_in > 0:
            fades.append(f"fade=t=in:st=0:d={fx.fade_in:.3f}")
        if fx.fade_out > 0:
            fades.append(f"fade=t=out:st={max(0.0, total - fx.fade_out):.3f}:d={fx.fade_out:.3f}")
        parts.append(f"[{v}]{','.join(fades)}[vfade]")
        v = "vfade"
    parts.append(f"[{v}]format=yuv420p[vout]")
    return ";".join(parts), "[vout]", audio_out


SPEECH_PAD = (0.15, 0.3)  # same as the preview mixer (src/features/preview/musicMixer.ts)
DUCK_RAMP = 0.125         # seconds to dip/recover, like the preview's smoothing


def _speech_regions(words: list[dict]) -> list[tuple[float, float]]:
    regions: list[list[float]] = []
    for w in sorted(words, key=lambda w: w["start"]):
        a, b = w["start"] - SPEECH_PAD[0], w["end"] + SPEECH_PAD[1]
        if regions and a <= regions[-1][1] + DUCK_RAMP:
            regions[-1][1] = max(regions[-1][1], b)
        else:
            regions.append([a, b])
    return [(a, b) for a, b in regions]


def _duck_expr(regions: list[tuple[float, float]], amount: float) -> str:
    """Gain over timeline time t: 1 outside speech, (1 - amount) during it, with ramps.
    Deterministic, so the export dips exactly as much as the preview."""
    r = DUCK_RAMP
    terms = "+".join(f"clip((t-{a - r:.3f})/{r},0,1)*clip(({b + r:.3f}-t)/{r},0,1)" for a, b in regions)
    return f"1-{amount:.3f}*min(1,{terms})"


def _music_mix(spec: RenderSpec, first_input: int, parts: list[str]) -> str:
    """Mix music under the speech ([ac]). Music inputs follow the segment inputs and are
    looped with -stream_loop; ducking follows the spoken words, like the preview."""
    if not spec.music:
        return "[ac]"
    regions = _speech_regions(spec.words)
    labels = []
    for k, m in enumerate(spec.music):
        dur = max(0.1, m.end - m.start)
        chain = f"[{first_input + k}:a]atrim=0:{dur:.3f},asetpts=PTS-STARTPTS,aresample=48000,aformat=channel_layouts=stereo,volume={m.volume:.3f}"
        if m.fade_in > 0:
            chain += f",afade=t=in:d={min(m.fade_in, dur):.3f}"
        if m.fade_out > 0:
            chain += f",afade=t=out:st={max(0.0, dur - m.fade_out):.3f}:d={min(m.fade_out, dur):.3f}"
        if m.start > 0:
            chain += f",adelay=delays={int(m.start * 1000)}:all=1"
        if m.ducking and regions and m.duck_amount > 0:
            # After adelay, t is timeline time — the same clock as the caption words.
            chain += f",volume=eval=frame:volume='{_duck_expr(regions, min(1.0, m.duck_amount))}'"
        parts.append(f"{chain}[mus{k}]")
        labels.append(f"[mus{k}]")
    parts.append("[ac]" + "".join(labels) + f"amix=inputs={len(labels) + 1}:duration=first:normalize=0[aout]")
    return "[aout]"


def render(spec: RenderSpec, on_progress: Callable[[float, str], None], cancelled: Callable[[], bool]) -> dict:
    media = Path(spec.media_path)
    if not media.is_file():
        raise FileNotFoundError(f"Video not found: {media}")
    w, h = SIZES[spec.aspect]
    total = max(s.end for s in spec.segments)

    key = hashlib.sha1(json.dumps(spec.model_dump(), sort_keys=True).encode()).hexdigest()[:16]
    work = settings.cache_dir / "renders" / key
    work.mkdir(parents=True, exist_ok=True)
    if spec.output_path:
        final = _unique(Path(spec.output_path))
        final.parent.mkdir(parents=True, exist_ok=True)
        # Render to a .part file and rename on success, so a cancelled or failed export
        # never leaves a broken video with the real name.
        out = final.with_name(f"{final.stem}.part{final.suffix}")
    else:
        final = out = work / "render.mp4"

    on_progress(0.0, "Preparing fonts")
    fdir, factors = fonts.prepare()
    ass_name = fonts_rel = None
    if (spec.words and spec.caption_style) or spec.texts:
        builder = AssBuilder(w, h, factors)
        if spec.words and spec.caption_style:
            builder.add_captions([Word(x["text"], x["start"], x["end"]) for x in spec.words], spec.caption_style)
        for t in spec.texts:
            builder.add_text(t)
        (work / "captions.ass").write_text(builder.build(), "utf-8")
        ass_name = "captions.ass"
        # Relative paths keep the filtergraph free of Windows drive-letter escaping.
        try:
            fonts_rel = os.path.relpath(fdir, work).replace("\\", "/")
        except ValueError:  # different drive: copy the fonts next to the job
            shutil.copytree(fdir, work / "fonts", dirs_exist_ok=True)
            fonts_rel = "fonts"

    vignette_input = None
    if spec.effects.vignette > 0.01:
        vig = work / "vignette.png"
        _vignette_png(vig, w, h, min(1.0, spec.effects.vignette))
        vignette_input = len(spec.segments) + len(spec.music) + (1 if spec.watermark else 0)
    graph, vout, aout = _graph(spec, w, h, total, ass_name, fonts_rel, vignette_input)
    (work / "graph.txt").write_text(graph, "utf-8")  # kept for debugging
    encoder = ffmpeg.video_encoder()
    # One fast-seeked input per segment, so a clip deep into a long video doesn't
    # decode everything before it.
    inputs = []
    for seg in sorted(spec.segments, key=lambda s: s.start):
        inputs += ["-ss", f"{seg.src_start:.3f}", "-t", f"{seg.end - seg.start:.3f}", "-i", str(media)]
    for m in spec.music:
        if not Path(m.path).is_file():
            raise FileNotFoundError(f"Music file not found: {m.path}")
        inputs += ["-stream_loop", "-1", "-i", m.path]
    if spec.watermark:
        if not Path(spec.watermark.path).is_file():
            raise FileNotFoundError(f"Watermark image not found: {spec.watermark.path}")
        inputs += ["-loop", "1", "-i", spec.watermark.path]
    if vignette_input is not None:
        inputs += ["-loop", "1", "-i", str(work / "vignette.png")]
    args = [
        *inputs,
        "-filter_complex", graph, "-map", vout, "-map", aout,
        *encoder, "-r", str(FPS), "-pix_fmt", "yuv420p",
        "-c:a", "aac", "-b:a", "160k", "-ar", "48000",
        "-movflags", "+faststart", str(out),
    ]
    on_progress(0.02, "Rendering")
    try:
        ffmpeg.run(args, work, total, lambda f: on_progress(0.02 + 0.98 * f, "Rendering"), cancelled)
    except BaseException:
        if out != final:
            out.unlink(missing_ok=True)
        raise
    srt_path = None
    if out != final:
        out.replace(final)
        if spec.srt:
            srt_path = final.with_suffix(".srt")
            srt_path.write_text(spec.srt, "utf-8")
    log.info("Rendered %s (%.1fs, %s)", final, total, encoder[1])
    return {"path": str(final), "srt_path": str(srt_path) if srt_path else None, "width": w, "height": h, "duration": total, "encoder": encoder[1]}


def _unique(path: Path) -> Path:
    """Never overwrite: 'Title.mp4' -> 'Title (2).mp4' if taken."""
    if not path.exists():
        return path
    n = 2
    while (candidate := path.with_name(f"{path.stem} ({n}){path.suffix}")).exists():
        n += 1
    return candidate
