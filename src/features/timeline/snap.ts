import type { TimelineDoc } from '../../types/editor'
import { timelineWords } from '../../lib/timelineWords'

export const SNAP_PX = 8

/** Every time an edge may snap to: zero, the playhead, item edges and word boundaries. */
export function snapPoints(doc: TimelineDoc, playhead: number, excludeIds: Set<string>): number[] {
  const pts = [0, playhead]
  for (const list of [doc.video, doc.texts, doc.audio]) {
    for (const it of list) if (!excludeIds.has(it.id)) pts.push(it.start, it.end)
  }
  for (const w of timelineWords(doc)) if (!excludeIds.has(w.id)) pts.push(w.start, w.end)
  return pts
}

/** Returns the nearest point within `threshold` seconds, or null. */
export function nearest(points: number[], t: number, threshold: number): number | null {
  let best: number | null = null
  let bestD = threshold
  for (const p of points) {
    const d = Math.abs(p - t)
    if (d <= bestD) {
      best = p
      bestD = d
    }
  }
  return best
}

/** Picks a "nice" ruler interval so major ticks are at least ~80px apart. */
export function tickInterval(pxPerSec: number): number {
  const steps = [0.5, 1, 2, 5, 10, 15, 30, 60, 120, 300]
  return steps.find((s) => s * pxPerSec >= 80) ?? 600
}
