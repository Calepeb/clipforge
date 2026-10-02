import { create } from 'zustand'
import { uid } from '../lib/time'

export type LeftTab = 'media' | 'clips' | 'captions' | 'audio' | 'effects' | 'templates'

export interface Toast {
  id: string
  kind: 'info' | 'success' | 'error'
  title: string
  body?: string
}

export interface Job {
  id: string
  label: string
  stage: string
  progress: number
  status: 'running' | 'done' | 'error' | 'cancelled'
}

interface UiState {
  leftTab: LeftTab
  exportOpen: boolean
  settingsOpen: boolean
  /** Media the AI Clips tab will generate from. */
  genSourceId: string | null
  toasts: Toast[]
  jobs: Job[]
  setLeftTab: (t: LeftTab) => void
  setExportOpen: (o: boolean) => void
  setSettingsOpen: (o: boolean) => void
  setGenSource: (id: string) => void
  toast: (t: Omit<Toast, 'id'>) => void
  dismissToast: (id: string) => void
  upsertJob: (j: Job) => void
  clearFinishedJobs: () => void
}

export const useUi = create<UiState>((set) => ({
  leftTab: 'clips',
  exportOpen: false,
  settingsOpen: false,
  genSourceId: null,
  toasts: [],
  jobs: [],
  setLeftTab: (leftTab) => set({ leftTab }),
  setExportOpen: (exportOpen) => set({ exportOpen }),
  setSettingsOpen: (settingsOpen) => set({ settingsOpen }),
  setGenSource: (genSourceId) => set({ genSourceId, leftTab: 'clips' }),
  toast: (t) => {
    const id = uid('toast')
    set((s) => ({ toasts: [...s.toasts, { ...t, id }] }))
    setTimeout(() => useUi.getState().dismissToast(id), 4200)
  },
  dismissToast: (id) => set((s) => ({ toasts: s.toasts.filter((t) => t.id !== id) })),
  upsertJob: (j) =>
    set((s) => ({ jobs: s.jobs.some((x) => x.id === j.id) ? s.jobs.map((x) => (x.id === j.id ? j : x)) : [...s.jobs, j] })),
  clearFinishedJobs: () => set((s) => ({ jobs: s.jobs.filter((j) => j.status === 'running') })),
}))

/**
 * Phase 1 stand-in for backend jobs: walks through stages over `ms` and reports progress.
 * Replaced by WebSocket progress events in Phase 2.
 */
export function runMockJob(label: string, stages: string[], ms: number, onProgress?: (p: number) => void): Promise<void> {
  const { upsertJob } = useUi.getState()
  const id = uid('job')
  const t0 = performance.now()
  return new Promise((resolve) => {
    const tick = () => {
      const p = Math.min(1, (performance.now() - t0) / ms)
      const stage = stages[Math.min(stages.length - 1, Math.floor(p * stages.length))]
      upsertJob({ id, label, stage, progress: p, status: p < 1 ? 'running' : 'done' })
      onProgress?.(p)
      if (p < 1) setTimeout(tick, 120)
      else resolve()
    }
    tick()
  })
}
