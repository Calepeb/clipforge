// Batch export queue. Clips render one at a time on the backend (the GPU encoder is
// shared), each to "<folder>/<title>.mp4" (+ .srt). The queue keeps running when the
// export dialog is closed; progress also shows in the top-bar jobs menu.
import { create } from 'zustand'
import { useEditor } from './editorStore'
import { useUi } from './uiStore'
import { cancelJob, JobCancelledError, runJob } from '../lib/backend'
import { buildRenderSpec, buildSrt, RenderSpecError, type RenderSpec } from '../lib/renderSpec'
import { safeFilename, uid } from '../lib/time'

export type ExportStatus = 'queued' | 'rendering' | 'done' | 'error' | 'cancelled'

export interface ExportItem {
  id: string
  clipId: string
  title: string
  filename: string
  status: ExportStatus
  progress: number
  jobId?: string
  outputPath?: string
  error?: string
  /** Edit snapshot taken when the export was queued. */
  spec?: RenderSpec
}

interface ExportState {
  folder: string | null
  includeSrt: boolean
  items: ExportItem[]
  running: boolean
  init: () => Promise<void>
  chooseFolder: () => Promise<void>
  setIncludeSrt: (v: boolean) => void
  enqueue: (clipIds: string[]) => void
  cancel: (itemId: string) => void
  retry: (itemId: string) => void
  clearFinished: () => void
}

const FOLDER_KEY = 'cf.exportFolder'
const sep = () => (window.clipforge?.platform === 'win32' ? '\\' : '/')
const join = (dir: string, name: string) => (dir.endsWith(sep()) ? dir + name : dir + sep() + name)

function readFolder(): string | null {
  try {
    return localStorage.getItem(FOLDER_KEY)
  } catch {
    return null
  }
}

export const useExport = create<ExportState>((set, get) => {
  const patch = (id: string, p: Partial<ExportItem>) => set((s) => ({ items: s.items.map((i) => (i.id === id ? { ...i, ...p } : i)) }))

  /** Builds the render request for an item (fresh, so retries pick up fixes). */
  const prepare = (item: ExportItem): RenderSpec => {
    const { folder, includeSrt } = get()
    if (!folder) throw new RenderSpecError('Choose an export folder first.')
    const spec = buildRenderSpec(item.clipId, join(folder, item.filename))
    if (includeSrt) spec.srt = buildSrt(item.clipId)
    return spec
  }

  /** Render queued items one after another. */
  const pump = async () => {
    if (get().running) return
    set({ running: true })
    let done = 0
    let failed = 0
    try {
      for (let next = get().items.find((i) => i.status === 'queued'); next; next = get().items.find((i) => i.status === 'queued')) {
        const item = next
        patch(item.id, { status: 'rendering', progress: 0, error: undefined })
        try {
          const spec = item.spec ?? prepare(item)
          const res = await runJob<{ path: string }>('/jobs/render-clip', spec, (j) => patch(item.id, { jobId: j.id, progress: j.progress }))
          patch(item.id, { status: 'done', progress: 1, outputPath: res.path })
          done++
        } catch (err) {
          if (err instanceof JobCancelledError) {
            patch(item.id, { status: 'cancelled' })
          } else {
            console.error('[export]', item.title, err)
            patch(item.id, { status: 'error', error: err instanceof Error ? err.message : String(err) })
            failed++
          }
        }
      }
    } finally {
      set({ running: false })
    }
    const toast = useUi.getState().toast
    if (done && !failed) toast({ kind: 'success', title: `Exported ${done} clip${done === 1 ? '' : 's'}`, body: get().folder ?? undefined })
    else if (failed) toast({ kind: 'error', title: `${failed} export${failed === 1 ? '' : 's'} failed`, body: done ? `${done} succeeded. Open Export to retry.` : 'Open Export to see why and retry.' })
  }

  return {
    folder: readFolder(),
    includeSrt: true,
    items: [],
    running: false,

    /** Uses the folder you chose last time, otherwise Videos/ClipForge/<project name>. */
    init: async () => {
      if (!window.clipforge) return
      const chosen = readFolder()
      if (chosen) return set({ folder: chosen })
      const base = await window.clipforge.exportDefaultDir()
      const project = safeFilename(useEditor.getState().projectName || 'ClipForge')
      set({ folder: join(base, project) })
    },

    chooseFolder: async () => {
      const dir = await window.clipforge?.chooseFolder(get().folder ?? undefined)
      if (!dir) return
      set({ folder: dir })
      try {
        localStorage.setItem(FOLDER_KEY, dir)
      } catch {
        // per-viewer convenience only
      }
    },

    setIncludeSrt: (includeSrt) => set({ includeSrt }),

    enqueue: (clipIds) => {
      const { data } = useEditor.getState()
      // Unique names within the batch; the backend also never overwrites files on disk.
      const used = new Set(get().items.filter((i) => i.status !== 'cancelled').map((i) => i.filename.toLowerCase()))
      const items: ExportItem[] = []
      for (const clipId of clipIds) {
        const clip = data.clips.find((c) => c.id === clipId)
        if (!clip) continue
        const base = safeFilename(clip.title)
        let filename = `${base}.mp4`
        for (let n = 2; used.has(filename.toLowerCase()); n++) filename = `${base} (${n}).mp4`
        used.add(filename.toLowerCase())
        const item: ExportItem = { id: uid('exp'), clipId, title: clip.title, filename, status: 'queued', progress: 0 }
        try {
          item.spec = prepare(item) // snapshot the edit as it is right now
        } catch (err) {
          item.status = 'error'
          item.error = err instanceof RenderSpecError || err instanceof Error ? err.message : String(err)
        }
        items.push(item)
      }
      set((s) => ({ items: [...s.items, ...items] }))
      void pump()
    },

    cancel: (itemId) => {
      const item = get().items.find((i) => i.id === itemId)
      if (!item) return
      if (item.status === 'queued') patch(itemId, { status: 'cancelled' })
      if (item.status === 'rendering' && item.jobId) cancelJob(item.jobId).catch(() => undefined)
    },

    retry: (itemId) => {
      const item = get().items.find((i) => i.id === itemId)
      if (!item) return
      let spec: RenderSpec | undefined
      try {
        spec = prepare(item)
      } catch (err) {
        patch(itemId, { status: 'error', error: err instanceof Error ? err.message : String(err) })
        return
      }
      patch(itemId, { status: 'queued', progress: 0, error: undefined, spec })
      void pump()
    },

    clearFinished: () => set((s) => ({ items: s.items.filter((i) => i.status === 'queued' || i.status === 'rendering') })),
  }
})
