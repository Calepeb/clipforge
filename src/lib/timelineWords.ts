// Captions are stored in SOURCE time (seconds into the original video) and projected onto
// the timeline through the video segments. Trimming, splitting, moving or deleting video
// therefore carries the captions along automatically, and words under cut-away footage
// simply disappear (and come back on undo).
import type { MediaAsset, TimelineDoc, VideoItem, Word } from '../types/editor'

const cache = new WeakMap<TimelineDoc, Word[]>()

/** Source-time → timeline-time mapping for one segment. */
const toTimeline = (v: VideoItem, src: number) => v.start + (src - v.srcStart)
export const toSource = (v: VideoItem, t: number) => v.srcStart + (t - v.start)

/**
 * Words visible on the timeline, in timeline time, sorted. A word belongs to the segment
 * containing its midpoint; it's clipped to the segment's edges. If several segments show
 * the same source moment, the first one wins (word ids stay unique).
 */
export function timelineWords(doc: TimelineDoc): Word[] {
  const hit = cache.get(doc)
  if (hit) return hit
  const segs = [...doc.video].sort((a, b) => a.start - b.start)
  const out: Word[] = []
  for (const w of doc.words) {
    const mid = (w.start + w.end) / 2
    const v = segs.find((s) => mid >= s.srcStart && mid < s.srcStart + (s.end - s.start))
    if (!v) continue
    out.push({
      id: w.id,
      text: w.text,
      start: Math.max(v.start, toTimeline(v, w.start)),
      end: Math.min(v.end, toTimeline(v, w.end)),
    })
  }
  out.sort((a, b) => a.start - b.start)
  cache.set(doc, out)
  return out
}

/**
 * Adds transcript words inside a newly revealed source range [from, to) — e.g. after
 * extending a trim. Only that range is filled, so captions you deleted elsewhere stay deleted.
 */
export function fillFromTranscript(
  words: Word[], transcript: MediaAsset['transcript'], from: number, to: number, idPrefix: string,
): Word[] {
  if (!transcript || to <= from) return words
  const added: Word[] = []
  for (const t of transcript) {
    const mid = (t.start + t.end) / 2
    if (mid < from || mid >= to) continue
    if (words.some((w) => w.start < t.end && w.end > t.start)) continue
    added.push({ id: `${idPrefix}_${t.start.toFixed(2)}`, text: t.text, start: t.start, end: t.end })
  }
  return added.length ? [...words, ...added].sort((x, y) => x.start - y.start) : words
}
