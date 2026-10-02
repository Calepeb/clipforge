// Framing math shared by the preview canvas. Must match backend/clipforge/render/clip.py.
import type { Framing } from '../types/editor'

/** Subject centre (0..1 of source width) at a source time, from auto-reframe keyframes. */
export function subjectAt(keys: { t: number; x: number }[], srcTime: number): number {
  if (srcTime <= keys[0].t) return keys[0].x
  for (let i = 1; i < keys.length; i++) {
    const a = keys[i - 1]
    const b = keys[i]
    if (srcTime < b.t) return b.t > a.t ? a.x + ((b.x - a.x) * (srcTime - a.t)) / (b.t - a.t) : b.x
  }
  return keys[keys.length - 1].x
}

/** Source-pixel width of the crop that fills a w × h output (cover), like drawCover. */
export function cropWidth(vw: number, vh: number, w: number, h: number, zoom: number): number {
  return Math.min(vw, w / (Math.max(w / vw, h / vh) * zoom))
}

/** Focus (0..1 crop position) that centres a subject at cx. */
export function focusFor(cx: number, vw: number, sw: number): number {
  return vw <= sw ? 0.5 : Math.min(1, Math.max(0, (cx * vw - sw / 2) / (vw - sw)))
}

/** Crop focus for 'track'/'center' modes at a given source time. */
export function trackFocus(f: Framing, srcTime: number, vw: number, vh: number, w: number, h: number): number {
  if (f.mode === 'center') return 0.5
  if (f.keyframes?.length) return focusFor(subjectAt(f.keyframes, srcTime), vw, cropWidth(vw, vh, w, h, f.zoom))
  return f.focusX
}

/** Crop focus for the top and bottom halves in split-screen mode. */
export function splitFocus(f: Framing, vw: number, vh: number, w: number, halfH: number): [number, number] {
  if (!f.splitX) return [0.15, 0.85]
  const sw = cropWidth(vw, vh, w, halfH, f.zoom)
  return [focusFor(f.splitX[0], vw, sw), focusFor(f.splitX[1], vw, sw)]
}
