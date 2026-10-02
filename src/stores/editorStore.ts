import { create } from 'zustand'
import { produce, type Draft } from 'immer'
import type { AiClip, AspectRatio, CaptionStyle, MediaAsset, MusicAsset, Selection, TimelineDoc, VideoItem } from '../types/editor'
import { CAPTION_PRESETS, chunkWords } from '../lib/captions'
import { clamp, uid } from '../lib/time'
import { timelineWords } from '../lib/timelineWords'
import { DEFAULT_TIGHTEN, tighten } from '../lib/tighten'
import { mockDoc } from '../mocks/data'

/** The undoable part of the project. */
export interface ProjectData {
  clips: AiClip[]
  docs: Record<string, TimelineDoc>
  styles: Record<string, CaptionStyle>
}

const HISTORY_LIMIT = 200
const COALESCE_MS = 600

interface EditorState {
  projectName: string
  aspect: AspectRatio
  media: MediaAsset[]
  music: MusicAsset[]
  data: ProjectData
  activeClipId: string | null
  selection: Selection
  time: number
  playing: boolean
  pxPerSec: number
  snapping: boolean
  past: ProjectData[]
  future: ProjectData[]
  lastCommit: { key: string; at: number } | null

  /** Apply an undoable change. Calls sharing a `coalesceKey` in quick succession form one undo step. */
  commit: (recipe: (d: Draft<ProjectData>) => void, coalesceKey?: string) => void
  undo: () => void
  redo: () => void

  setProjectName: (name: string) => void
  setAspect: (a: AspectRatio) => void
  addMedia: (m: MediaAsset) => void
  addMusic: (m: MusicAsset) => void
  updateMusic: (id: string, patch: Partial<MusicAsset>) => void
  updateMedia: (id: string, patch: Partial<MediaAsset>) => void
  /** Replace all clips (after generation). Clears history. */
  replaceClips: (data: ProjectData) => void
  /** Swap in a whole project (opened from disk or newly created). Clears history and playback. */
  loadProject: (p: { name: string; aspect: AspectRatio; media: MediaAsset[]; music?: MusicAsset[]; data: ProjectData; activeClipId: string | null }) => void
  openClip: (id: string) => void
  select: (s: Selection) => void
  seek: (t: number) => void
  setPlaying: (p: boolean) => void
  setPxPerSec: (v: number) => void
  toggleSnapping: () => void
  splitAtPlayhead: () => void
  /** Delete the selection. Deleting video ripples later items left unless `ripple` is false. */
  deleteSelection: (opts?: { ripple?: boolean }) => void
  /** Turn silence/filler removal on or off for a clip (undoable). */
  setTightened: (clipId: string, on: boolean) => { removed: number; fillers: number } | null
  /** Join a video segment with the next one when they're continuous in the source video. */
  mergeWithNext: (videoId: string) => boolean
}

export function buildData(clips: AiClip[]): ProjectData {
  const docs: Record<string, TimelineDoc> = {}
  const styles: Record<string, CaptionStyle> = {}
  clips.forEach((c, i) => {
    docs[c.id] = mockDoc(c, i + 1)
    styles[c.id] = { ...CAPTION_PRESETS[0].style }
  })
  return { clips, docs, styles }
}

export const docDuration = (doc: TimelineDoc | undefined) =>
  doc ? Math.max(0, ...doc.video.map((v) => v.end), ...doc.audio.map((a) => a.end)) : 0

export const useEditor = create<EditorState>((set, get) => ({
  projectName: '',
  aspect: '9:16',
  media: [],
  music: [],
  data: { clips: [], docs: {}, styles: {} },
  activeClipId: null,
  selection: null,
  time: 0,
  playing: false,
  pxPerSec: 40,
  snapping: true,
  past: [],
  future: [],
  lastCommit: null,

  commit: (recipe, coalesceKey) => {
    const { data, past, lastCommit } = get()
    const next = produce(data, recipe)
    if (next === data) return
    const now = performance.now()
    const coalesce = coalesceKey && lastCommit?.key === coalesceKey && now - lastCommit.at < COALESCE_MS
    set({
      data: next,
      past: coalesce ? past : [...past.slice(-HISTORY_LIMIT + 1), data],
      future: [],
      lastCommit: coalesceKey ? { key: coalesceKey, at: now } : null,
    })
  },
  undo: () => {
    const { past, future, data } = get()
    if (!past.length) return
    set({ data: past[past.length - 1], past: past.slice(0, -1), future: [data, ...future], lastCommit: null })
    fixSelection(get, set)
  },
  redo: () => {
    const { past, future, data } = get()
    if (!future.length) return
    set({ data: future[0], future: future.slice(1), past: [...past, data], lastCommit: null })
    fixSelection(get, set)
  },

  setProjectName: (projectName) => set({ projectName }),
  setAspect: (aspect) => set({ aspect }),
  addMedia: (m) => set((s) => ({ media: [...s.media, m] })),
  addMusic: (m) => set((s) => ({ music: [...s.music, m] })),
  updateMusic: (id, patch) => set((s) => ({ music: s.music.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
  updateMedia: (id, patch) => set((s) => ({ media: s.media.map((m) => (m.id === id ? { ...m, ...patch } : m)) })),
  replaceClips: (data) =>
    set({ data, activeClipId: data.clips[0]?.id ?? null, selection: null, time: 0, playing: false, past: [], future: [] }),
  loadProject: (p) =>
    set({
      projectName: p.name,
      aspect: p.aspect,
      media: p.media,
      music: p.music ?? [],
      data: p.data,
      activeClipId: p.activeClipId && p.data.docs[p.activeClipId] ? p.activeClipId : (p.data.clips[0]?.id ?? null),
      selection: null,
      time: 0,
      playing: false,
      past: [],
      future: [],
      lastCommit: null,
    }),
  openClip: (id) => set({ activeClipId: id, selection: null, time: 0, playing: false }),
  select: (selection) => set({ selection }),
  seek: (t) => {
    const { data, activeClipId } = get()
    const dur = docDuration(activeClipId ? data.docs[activeClipId] : undefined)
    set({ time: clamp(t, 0, dur) })
  },
  setPlaying: (playing) => set({ playing }),
  setPxPerSec: (pxPerSec) => set({ pxPerSec: clamp(pxPerSec, 8, 400) }),
  toggleSnapping: () => set((s) => ({ snapping: !s.snapping })),

  splitAtPlayhead: () => {
    const { activeClipId, time, selection, commit } = get()
    if (!activeClipId) return
    commit((d) => {
      const doc = d.docs[activeClipId]
      const inside = (it: { start: number; end: number }) => time > it.start + 0.05 && time < it.end - 0.05
      // Split the selected item if it spans the playhead, otherwise the video item under it.
      const kind = selection && selection.kind !== 'caption' ? selection.kind : 'video'
      const list = kind === 'video' ? doc.video : kind === 'text' ? doc.texts : doc.audio
      const idx = list.findIndex((it) => inside(it) && (!selection || selection.kind === 'caption' || it.id === selection.id))
      if (idx < 0) return
      const item = list[idx]
      const right = { ...item, id: uid(kind[0]), start: time } as (typeof list)[number]
      if ('srcStart' in right && 'srcStart' in item) right.srcStart = item.srcStart + (time - item.start)
      item.end = time
      list.splice(idx + 1, 0, right as never)
    })
  },
  deleteSelection: ({ ripple = true } = {}) => {
    const { activeClipId, selection, commit, data } = get()
    if (!activeClipId || !selection) return
    const perChunk = data.styles[activeClipId]?.wordsPerChunk ?? 3
    commit((d) => {
      const doc = d.docs[activeClipId]
      if (selection.kind === 'video') {
        const seg = doc.video.find((v) => v.id === selection.id)
        doc.video = doc.video.filter((v) => v.id !== selection.id)
        if (seg && ripple) {
          // Close the gap: everything that started after the segment moves left.
          const dur = seg.end - seg.start
          for (const list of [doc.video, doc.texts, doc.audio]) {
            for (const it of list) {
              if (it.start >= seg.end - 1e-3) { it.start -= dur; it.end -= dur }
            }
          }
        }
      }
      if (selection.kind === 'text') doc.texts = doc.texts.filter((v) => v.id !== selection.id)
      if (selection.kind === 'audio') doc.audio = doc.audio.filter((v) => v.id !== selection.id)
      if (selection.kind === 'caption') {
        const ids = captionChunkWordIds(data.docs[activeClipId], selection.id, perChunk)
        doc.words = doc.words.filter((w) => !ids.has(w.id))
      }
    })
    set({ selection: null })
  },
  setTightened: (clipId, on) => {
    const doc = get().data.docs[clipId]
    if (!doc) return null
    if (!on) {
      if (!doc.tightened) return null
      get().commit((d) => {
        const dd = d.docs[clipId]
        Object.assign(dd, dd.tightened!.original)
        dd.tightened = null
      })
      return null
    }
    if (doc.tightened) return { removed: doc.tightened.removed, fillers: doc.tightened.fillers }
    const res = tighten(doc, DEFAULT_TIGHTEN)
    get().commit((d) => {
      const dd = d.docs[clipId]
      dd.tightened = { removed: res.removed, fillers: res.fillers, original: { video: doc.video, texts: doc.texts, audio: doc.audio } }
      dd.video = res.video
      for (const it of [...dd.texts, ...dd.audio]) {
        const start = it.start - res.shiftAt(it.start)
        const end = Math.max(start + 0.2, it.end - res.shiftAt(it.end))
        it.start = start
        it.end = end
      }
    })
    const { time } = get()
    set({ time: Math.max(0, time - res.shiftAt(time)), selection: null })
    return { removed: res.removed, fillers: res.fillers }
  },
  mergeWithNext: (videoId) => {
    const { activeClipId, data, commit } = get()
    if (!activeClipId) return false
    const doc = data.docs[activeClipId]
    const pair = mergeablePair(doc, videoId)
    if (!pair) return false
    commit((d) => {
      const dd = d.docs[activeClipId]
      const a = dd.video.find((v) => v.id === pair[0].id)!
      a.end = pair[1].end
      dd.video = dd.video.filter((v) => v.id !== pair[1].id)
    })
    set({ selection: { kind: 'video', id: videoId } })
    return true
  },
}))

/** The segment and the one right after it, if they continue each other in the same source. */
export function mergeablePair(doc: TimelineDoc, videoId: string): [VideoItem, VideoItem] | null {
  const segs = [...doc.video].sort((a, b) => a.start - b.start)
  const i = segs.findIndex((v) => v.id === videoId)
  const a = segs[i]
  const b = segs[i + 1]
  if (!a || !b || a.mediaId !== b.mediaId) return null
  const touching = Math.abs(b.start - a.end) < 0.05
  const continuous = Math.abs(b.srcStart - (a.srcStart + (a.end - a.start))) < 0.05
  return touching && continuous ? [a, b] : null
}

export function captionChunkWordIds(doc: TimelineDoc, chunkId: string, perChunk: number): Set<string> {
  const chunk = chunkWords(timelineWords(doc), perChunk).find((c) => c.id === chunkId)
  return new Set(chunk?.words.map((w) => w.id) ?? [])
}

/** Drop a selection that no longer exists after undo/redo. */
function fixSelection(get: () => EditorState, set: (p: Partial<EditorState>) => void) {
  const { selection, activeClipId, data } = get()
  if (!selection || !activeClipId) return
  const doc = data.docs[activeClipId]
  const exists =
    selection.kind === 'video' ? doc.video.some((v) => v.id === selection.id)
    : selection.kind === 'text' ? doc.texts.some((v) => v.id === selection.id)
    : selection.kind === 'audio' ? doc.audio.some((v) => v.id === selection.id)
    : doc.words.some((w) => w.id === selection.id)
  if (!exists) set({ selection: null })
}

// Convenience selectors
export const useActiveDoc = () => useEditor((s) => (s.activeClipId ? s.data.docs[s.activeClipId] : undefined))
export const useActiveStyle = () => useEditor((s) => (s.activeClipId ? s.data.styles[s.activeClipId] : undefined))
export const useActiveClip = () => useEditor((s) => s.data.clips.find((c) => c.id === s.activeClipId))
