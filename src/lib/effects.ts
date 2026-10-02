// Per-clip visual/audio effects. Everything is computed here once (zoom schedule, colour
// matrix) and used both by the preview and the FFmpeg renderer, so they match.
import type { ClipEffects, TimelineDoc } from '../types/editor'
import { isKeyword } from './captions'
import { timelineWords } from './timelineWords'

export const DEFAULT_EFFECTS: ClipEffects = {
  zoom: { enabled: false, amount: 1.15, trigger: 'sentence', interval: 3 },
  color: { preset: 'none', brightness: 0, contrast: 1, saturation: 1, warmth: 0 },
  vignette: 0,
  fadeIn: 0,
  fadeOut: 0,
  normalizeAudio: false,
}

export const effectsOf = (doc: TimelineDoc): ClipEffects => ({ ...DEFAULT_EFFECTS, ...doc.effects })

export const COLOR_PRESETS: { id: string; name: string; color: Omit<ClipEffects['color'], 'preset'>; vignette?: number }[] = [
  { id: 'none', name: 'Original', color: { brightness: 0, contrast: 1, saturation: 1, warmth: 0 } },
  { id: 'vivid', name: 'Vivid', color: { brightness: 0.02, contrast: 1.12, saturation: 1.35, warmth: 0.05 } },
  { id: 'warm', name: 'Warm', color: { brightness: 0.03, contrast: 1.05, saturation: 1.1, warmth: 0.45 } },
  { id: 'cool', name: 'Cool', color: { brightness: 0, contrast: 1.05, saturation: 1.05, warmth: -0.45 } },
  { id: 'cinematic', name: 'Cinematic', color: { brightness: -0.04, contrast: 1.2, saturation: 0.85, warmth: 0.15 }, vignette: 0.35 },
  { id: 'bw', name: 'B&W', color: { brightness: 0, contrast: 1.15, saturation: 0, warmth: 0 } },
  { id: 'matte', name: 'Matte', color: { brightness: 0.06, contrast: 0.85, saturation: 0.8, warmth: 0.05 } },
  { id: 'punchy', name: 'Punchy', color: { brightness: 0, contrast: 1.3, saturation: 1.2, warmth: 0 } },
]

/**
 * Colour adjustment as one affine map in sRGB: out = M · in + c (values 0..1).
 * Saturation uses the same luminance-preserving matrix as SVG/CSS saturate(); contrast
 * pivots around mid-grey; warmth shifts red up and blue down.
 */
export function colorTransform(c: ClipEffects['color']): { matrix: number[]; offset: [number, number, number] } | null {
  const { brightness: b, contrast: k, saturation: s, warmth: w } = c
  if (b === 0 && k === 1 && s === 1 && w === 0) return null
  const sat = [
    0.213 + 0.787 * s, 0.715 - 0.715 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 + 0.285 * s, 0.072 - 0.072 * s,
    0.213 - 0.213 * s, 0.715 - 0.715 * s, 0.072 + 0.928 * s,
  ]
  const matrix = sat.map((v) => +(v * k).toFixed(4))
  const base = 0.5 - 0.5 * k + b
  return { matrix, offset: [+(base + 0.07 * w).toFixed(4), +(base + 0.01 * w).toFixed(4), +(base - 0.07 * w).toFixed(4)] }
}

const MIN_ZOOM_HOLD = 1.2 // seconds — shorter zooms feel like glitches

/** Timeline intervals during which the auto zoom is "punched in". */
export function zoomIntervals(doc: TimelineDoc, fx: ClipEffects): [number, number][] {
  if (!fx.zoom.enabled) return []
  const end = Math.max(0, ...doc.video.map((v) => v.end))
  const words = timelineWords(doc)
  const out: [number, number][] = []
  if (fx.zoom.trigger === 'interval') {
    for (let t = fx.zoom.interval, on = true; t < end; t += fx.zoom.interval, on = !on) {
      if (on) out.push([t, Math.min(end, t + fx.zoom.interval)])
    }
  } else if (fx.zoom.trigger === 'keyword') {
    for (const w of words) if (isKeyword(w.text)) out.push([Math.max(0, w.start - 0.1), Math.max(w.end + 0.6, w.start + MIN_ZOOM_HOLD)])
  } else {
    // Every other sentence is punched in, cutting on the sentence's first word.
    const starts = words.filter((w, i) => i === 0 || /[.!?]$/.test(words[i - 1].text) || w.start - words[i - 1].end > 0.6).map((w) => w.start)
    for (let i = 1; i < starts.length; i += 2) out.push([starts[i], starts[i + 1] ?? end])
  }
  // Merge overlaps and drop slivers.
  const merged: [number, number][] = []
  for (const [a, b] of out.sort((p, q) => p[0] - q[0])) {
    const last = merged[merged.length - 1]
    if (last && a <= last[1] + 0.3) last[1] = Math.max(last[1], b)
    else merged.push([a, Math.min(b, end)])
  }
  return merged.filter(([a, b]) => b - a >= MIN_ZOOM_HOLD * 0.8)
}

export const zoomAt = (intervals: [number, number][], amount: number, t: number) =>
  intervals.some(([a, b]) => t >= a && t < b) ? amount : 1

/** 0..1 black overlay for fade in/out at timeline time t. */
export function fadeAt(fx: ClipEffects, t: number, duration: number): number {
  let o = 0
  if (fx.fadeIn > 0 && t < fx.fadeIn) o = Math.max(o, 1 - t / fx.fadeIn)
  if (fx.fadeOut > 0 && t > duration - fx.fadeOut) o = Math.max(o, 1 - (duration - t) / fx.fadeOut)
  return Math.min(1, Math.max(0, o))
}
