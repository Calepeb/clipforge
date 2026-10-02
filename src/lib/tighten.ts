// "Tighten": remove filler words and shorten long pauses by rewriting the clip's video
// segments. Captions follow automatically (lib/timelineWords.ts), and the original
// segments are kept so the toggle can be switched off again.
import type { TimelineDoc, VideoItem, Word } from '../types/editor'
import { uid } from './time'

export interface TightenOptions {
  fillers: boolean
  /** Pauses longer than this (seconds) are shortened... */
  maxPause: number
  /** ...down to this much silence. */
  keepPause: number
}

export const DEFAULT_TIGHTEN: TightenOptions = { fillers: true, maxPause: 0.5, keepPause: 0.2 }

const FILLERS = new Set(['um', 'umm', 'uh', 'uhh', 'uhm', 'erm', 'er', 'ah', 'hmm', 'mm', 'mhm'])
const MIN_PIECE = 0.12 // drop slivers shorter than this
const PAD = 0.03       // keep a little air around speech so cuts don't clip syllables

export const isFiller = (text: string) => FILLERS.has(text.toLowerCase().replace(/[^a-z]/g, ''))

type Range = [number, number]

/** Source ranges inside [a, b) to remove. */
function removals(words: Word[], a: number, b: number, o: TightenOptions): Range[] {
  const inside = words.filter((w) => (w.start + w.end) / 2 >= a && (w.start + w.end) / 2 < b).sort((x, y) => x.start - y.start)
  const out: Range[] = []
  if (o.fillers) for (const w of inside) if (isFiller(w.text)) out.push([w.start - PAD, w.end + PAD])
  const spoken = o.fillers ? inside.filter((w) => !isFiller(w.text)) : inside
  // Long silences before the first word, between words and after the last word keep
  // keepPause/2 of air next to each word (so keepPause between two words).
  const keep = o.keepPause / 2
  const edges = [a, ...spoken.flatMap((w) => [w.start, w.end]), b]
  for (let i = 0; i < edges.length; i += 2) {
    const [gapStart, gapEnd] = [edges[i], edges[i + 1]]
    if (gapEnd - gapStart <= o.maxPause) continue
    const first = i === 0
    const last = i === edges.length - 2
    out.push([first ? gapStart : gapStart + keep, last ? gapEnd : gapEnd - keep])
  }
  return merge(out.map(([x, y]) => [Math.max(a, x), Math.min(b, y)] as Range).filter(([x, y]) => y > x))
}

function merge(ranges: Range[]): Range[] {
  const sorted = [...ranges].sort((p, q) => p[0] - q[0])
  const out: Range[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    if (last && r[0] <= last[1]) last[1] = Math.max(last[1], r[1])
    else out.push([...r])
  }
  return out
}

/**
 * New video segments with fillers/pauses removed, the seconds cut, the filler count, and
 * `shiftAt(t)`: how far an item at original timeline time t moves left.
 */
export function tighten(doc: TimelineDoc, o: TightenOptions): { video: VideoItem[]; removed: number; fillers: number; shiftAt: (t: number) => number } {
  const segs = [...doc.video].sort((x, y) => x.start - y.start)
  const video: VideoItem[] = []
  const cut: Range[] = [] // removed spans in ORIGINAL timeline time
  let fillers = 0
  let offset = 0
  for (const v of segs) {
    const a = v.srcStart
    const b = v.srcStart + (v.end - v.start)
    const toTl = (src: number) => v.start + (src - a)
    if (o.fillers) fillers += doc.words.filter((w) => isFiller(w.text) && (w.start + w.end) / 2 >= a && (w.start + w.end) / 2 < b).length
    // Pieces to keep = segment minus removals, ignoring slivers.
    const keepPieces: Range[] = []
    let src = a
    for (const [x, y] of removals(doc.words, a, b, o)) {
      if (x > src) keepPieces.push([src, x])
      src = y
    }
    if (b > src) keepPieces.push([src, b])
    const kept = keepPieces.filter(([x, y]) => y - x >= MIN_PIECE)
    let cursor = v.start - offset
    let prev = a
    for (const [x, y] of kept) {
      if (x > prev) cut.push([toTl(prev), toTl(x)])
      video.push({ ...v, id: uid('v'), srcStart: x, start: cursor, end: cursor + (y - x) })
      cursor += y - x
      prev = y
    }
    if (b > prev) cut.push([toTl(prev), toTl(b)])
    offset = v.end - cursor
  }
  const shiftAt = (t: number) => cut.reduce((s, [x, y]) => s + Math.max(0, Math.min(t, y) - x), 0)
  return { video, removed: offset, fillers, shiftAt }
}
