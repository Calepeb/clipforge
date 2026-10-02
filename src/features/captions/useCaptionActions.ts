import { useEditor } from '../../stores/editorStore'
import { useUi } from '../../stores/uiStore'
import { chunkWords, replaceChunkText, type CaptionChunk } from '../../lib/captions'
import { timelineWords } from '../../lib/timelineWords'
import type { CaptionStyle } from '../../types/editor'

export function useCaptionActions() {
  const commit = useEditor((s) => s.commit)
  const toast = useUi((s) => s.toast)

  const active = () => useEditor.getState().activeClipId

  return {
    /** Patch the active clip's caption style (slider drags coalesce into one undo step). */
    updateStyle(patch: Partial<CaptionStyle>, coalesceKey?: string) {
      const id = active()
      if (!id) return
      commit((d) => Object.assign(d.styles[id], patch), coalesceKey ?? `style-${Object.keys(patch).join()}`)
    },
    /** Apply a preset, keeping the user's caption position. */
    applyPreset(style: CaptionStyle) {
      const id = active()
      if (!id) return
      commit((d) => { d.styles[id] = { ...style, x: d.styles[id].x, y: d.styles[id].y } })
    },
    applyToAll() {
      const id = active()
      if (!id) return
      commit((d) => {
        const src = d.styles[id]
        for (const k of Object.keys(d.styles)) d.styles[k] = { ...src }
      })
      toast({ kind: 'success', title: 'Caption style applied to all clips' })
    },
    editChunk(chunk: CaptionChunk, text: string) {
      const id = active()
      if (!id || text.trim() === chunk.text || !text.trim()) return
      commit((d) => { d.docs[id].words = replaceChunkText(d.docs[id].words, chunk, text) })
    },
  }
}

export function useCaptionChunks() {
  const doc = useEditor((s) => (s.activeClipId ? s.data.docs[s.activeClipId] : undefined))
  const words = doc ? timelineWords(doc) : undefined
  const perChunk = useEditor((s) => (s.activeClipId ? s.data.styles[s.activeClipId]?.wordsPerChunk : 3)) ?? 3
  return { words, perChunk, chunks: words ? chunkWords(words, perChunk) : [] }
}
