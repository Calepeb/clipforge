// Runs auto-reframe (face tracking) on the backend and applies the results to clips.
import { useEditor } from '../stores/editorStore'
import { useUi } from '../stores/uiStore'
import { hasBackend, JobCancelledError, runJob } from './backend'
import type { ReframeMode } from '../types/editor'

interface ClipResult {
  mode: ReframeMode
  reason: string
  faces: number
  keyframes: { t: number; x: number }[]
  split_x: [number, number] | null
}

/** Analyse the given clips (all sharing one source video) and set their framing. Returns how many were updated. */
export async function autoReframe(clipIds: string[], opts: { quiet?: boolean } = {}): Promise<number> {
  const { data, media, aspect } = useEditor.getState()
  const toast = useUi.getState().toast
  const clips = clipIds.map((id) => ({ id, doc: data.docs[id] })).filter((c) => c.doc?.video.length)
  if (!clips.length || !hasBackend()) return 0
  const asset = media.find((m) => m.id === clips[0].doc.video[0].mediaId)
  if (!asset?.path || !asset.width || !asset.height) {
    if (!opts.quiet) toast({ kind: 'info', title: 'Auto-reframe needs a video file on disk' })
    return 0
  }
  try {
    const res = await runJob<{ clips: Record<string, ClipResult> }>('/jobs/reframe', {
      path: asset.path,
      source_width: asset.width,
      source_height: asset.height,
      aspect,
      clips: clips.map(({ id, doc }) => ({ id, ranges: doc.video.map((v) => [v.srcStart, v.srcStart + (v.end - v.start)]) })),
    })
    let updated = 0
    useEditor.getState().commit((d) => {
      for (const [id, r] of Object.entries(res.clips)) {
        const doc = d.docs[id]
        if (!doc) continue // clip was removed while the job ran
        doc.framing.mode = r.mode
        doc.framing.keyframes = r.keyframes
        doc.framing.splitX = r.split_x
        doc.framing.auto = { mode: r.mode, reason: r.reason, faces: r.faces }
        updated++
      }
    })
    if (!opts.quiet) toast({ kind: 'success', title: `Auto-reframed ${updated} clip${updated === 1 ? '' : 's'}` })
    return updated
  } catch (err) {
    if (err instanceof JobCancelledError) return 0
    console.error('[reframe]', err)
    toast({ kind: 'error', title: 'Auto-reframe failed', body: err instanceof Error ? err.message : String(err) })
    return 0
  }
}
