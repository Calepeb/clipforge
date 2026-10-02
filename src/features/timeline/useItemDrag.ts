import { useCallback } from 'react'
import type { Draft } from 'immer'
import { useEditor, type ProjectData } from '../../stores/editorStore'
import type { TimelineDoc, Word } from '../../types/editor'
import { nearest, snapPoints, SNAP_PX } from './snap'
import { fillFromTranscript, timelineWords } from '../../lib/timelineWords'

export type DragMode = 'move' | 'trim-l' | 'trim-r'
export type DragKind = 'video' | 'text' | 'audio' | 'caption'

const MIN_LEN = 0.2
const MIN_WORD = 0.05

type Span = { id: string; start: number; end: number }

function listOf(doc: TimelineDoc | Draft<TimelineDoc>, kind: Exclude<DragKind, 'caption'>): Span[] {
  return kind === 'video' ? doc.video : kind === 'text' ? doc.texts : doc.audio
}

/**
 * Pointer-driven move/trim for timeline items with snapping and no overlaps on a track.
 * For captions, `id` is the chunk id and `wordIds` the words it contains.
 * The whole gesture is one undo step.
 */
export function useItemDrag(setSnapLine: (t: number | null) => void) {
  return useCallback(
    (e: React.PointerEvent, kind: DragKind, id: string, mode: DragMode, wordIds?: string[]) => {
      e.stopPropagation()
      if (e.button !== 0) return
      const st = useEditor.getState()
      const clipId = st.activeClipId
      if (!clipId) return
      const doc = st.data.docs[clipId]
      const pps = st.pxPerSec
      const x0 = e.clientX
      const key = `drag-${id}-${performance.now()}`
      const thr = SNAP_PX / pps

      st.select({ kind, id })

      // Original geometry and allowed bounds, captured once at gesture start.
      let o: Span
      let lo = 0
      let hi = Infinity
      let srcStart = 0
      let maxSrc = Infinity
      const exclude = new Set<string>([id, ...(wordIds ?? [])])

      // Caption words are stored in source time; remember where they started so the
      // gesture applies timeline deltas to them (a move within a segment is a pure shift).
      const origWords = new Map(doc.words.filter((w) => wordIds?.includes(w.id)).map((w) => [w.id, { start: w.start, end: w.end }]))
      if (kind === 'caption') {
        const words = timelineWords(doc)
        const first = words.findIndex((w) => w.id === wordIds![0])
        const last = first + wordIds!.length - 1
        o = { id, start: words[first].start, end: words[last].end }
        lo = first > 0 ? words[first - 1].end : 0
        hi = last < words.length - 1 ? words[last + 1].start : Infinity
      } else {
        const list = [...listOf(doc, kind)].sort((a, b) => a.start - b.start)
        const i = list.findIndex((it) => it.id === id)
        o = list[i]
        lo = i > 0 ? list[i - 1].end : 0
        hi = i < list.length - 1 ? list[i + 1].start : Infinity
        if (kind === 'video') {
          const v = doc.video.find((x) => x.id === id)!
          srcStart = v.srcStart
          maxSrc = st.media.find((m) => m.id === v.mediaId)?.duration ?? Infinity
        }
      }
      const points = snapPoints(doc, st.time, exclude)
      // Video trims also snap to word boundaries from the full transcript, so extending a
      // clip lands between words even where it has no captions yet.
      if (kind === 'video' && mode !== 'move') {
        const v = doc.video.find((x) => x.id === id)!
        for (const w of st.media.find((m) => m.id === v.mediaId)?.transcript ?? []) {
          points.push(v.start + (w.start - v.srcStart), v.start + (w.end - v.srcStart))
        }
      }
      const snaps = st.snapping

      const move = (ev: PointerEvent) => {
        const delta = (ev.clientX - x0) / pps
        let s = o.start
        let en = o.end
        let line: number | null = null

        if (mode === 'move') {
          s = o.start + delta
          en = o.end + delta
          if (snaps) {
            const a = nearest(points, s, thr)
            const b = nearest(points, en, thr)
            if (a !== null && (b === null || Math.abs(a - s) <= Math.abs(b - en))) { en += a - s; s = a; line = a }
            else if (b !== null) { s += b - en; en = b; line = b }
          }
          const len = o.end - o.start
          if (s < lo) { s = lo; en = lo + len }
          if (en > hi) { en = hi; s = hi - len }
          if (kind === 'video' && s < 0) { s = 0; en = len }
        } else if (mode === 'trim-l') {
          s = o.start + delta
          if (snaps) { const a = nearest(points, s, thr); if (a !== null) { s = a; line = a } }
          const minStart = kind === 'video' ? Math.max(lo, o.start - srcStart) : lo
          s = Math.min(Math.max(s, minStart), o.end - (kind === 'caption' ? MIN_WORD : MIN_LEN))
        } else {
          en = o.end + delta
          if (snaps) { const b = nearest(points, en, thr); if (b !== null) { en = b; line = b } }
          const maxEnd = kind === 'video' ? Math.min(hi, o.start + (maxSrc - srcStart)) : hi
          en = Math.max(Math.min(en, maxEnd), o.start + (kind === 'caption' ? MIN_WORD : MIN_LEN))
        }
        setSnapLine(line !== null && (line === s || line === en) ? line : null)

        st.commit((d: Draft<ProjectData>) => {
          const dd = d.docs[clipId]
          if (kind === 'caption') {
            applyCaption(dd.words, origWords, wordIds!, s - o.start, en - o.end, mode)
            return
          }
          const it = listOf(dd, kind).find((x) => x.id === id)
          if (!it) return
          if (kind === 'video' && 'srcStart' in it) {
            const v = it as { srcStart: number }
            if (mode === 'trim-l') v.srcStart = srcStart + (s - o.start)
          }
          it.start = s
          it.end = en
        }, key)
      }
      const up = () => {
        setSnapLine(null)
        // A video trim may now reveal source footage with no captions: pull them from the transcript.
        if (kind === 'video' && mode !== 'move') {
          const now = useEditor.getState().data.docs[clipId].video.find((x) => x.id === id)
          if (now) {
            const transcript = st.media.find((m) => m.id === now.mediaId)?.transcript
            const oldSrcEnd = srcStart + (o.end - o.start)
            const newSrcEnd = now.srcStart + (now.end - now.start)
            // Only the newly revealed source footage: before the old in-point or after the old out-point.
            const [from, to] = mode === 'trim-l' ? [now.srcStart, srcStart] : [oldSrcEnd, newSrcEnd]
            if (to > from) {
              st.commit((d) => {
                const dd = d.docs[clipId]
                dd.words = fillFromTranscript(dd.words as Word[], transcript, from, to, `${clipId}_t`)
              }, key)
            }
          }
        }
        window.removeEventListener('pointermove', move)
        window.removeEventListener('pointerup', up)
      }
      window.addEventListener('pointermove', move)
      window.addEventListener('pointerup', up)
    },
    [setSnapLine],
  )
}

function applyCaption(
  words: Draft<Word>[], orig: Map<string, { start: number; end: number }>, ids: string[],
  dStart: number, dEnd: number, mode: DragMode,
) {
  const chunk = words.filter((w) => ids.includes(w.id)).sort((a, b) => a.start - b.start)
  if (!chunk.length) return
  const o = (w: Word) => orig.get(w.id)!
  if (mode === 'move') {
    for (const w of chunk) { w.start = o(w).start + dStart; w.end = o(w).end + dStart }
  } else if (mode === 'trim-l') {
    const first = chunk[0]
    first.start = Math.min(o(first).start + dStart, first.end - MIN_WORD)
  } else {
    const last = chunk[chunk.length - 1]
    last.end = Math.max(o(last).end + dEnd, last.start + MIN_WORD)
  }
}
