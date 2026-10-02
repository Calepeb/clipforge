import { create } from 'zustand'
import { buildData, useEditor } from './editorStore'
import { useUi } from './uiStore'
import { storage } from '../lib/projectStorage'
import { grabFrame } from '../lib/media'
import { uid } from '../lib/time'
import { SAMPLE_MEDIA, mockClips } from '../mocks/data'
import { PROJECT_VERSION, type ProjectFile, type ProjectMeta } from '../types/project'

export type SaveStatus = 'saved' | 'dirty' | 'saving' | 'error'

const AUTOSAVE_MS = 1500

interface ProjectSession {
  view: 'home' | 'editor'
  projectId: string | null
  createdAt: number
  status: SaveStatus
  lastSavedAt: number | null
  error: string | null
  recent: ProjectMeta[]
  loadingList: boolean

  refreshList: () => Promise<void>
  newProject: (opts?: { sample?: boolean }) => Promise<void>
  openProject: (id: string) => Promise<void>
  /** Save now (Ctrl+S). Resolves once the latest changes are on disk. */
  save: () => Promise<void>
  goHome: () => Promise<void>
  duplicate: (id: string) => Promise<void>
  rename: (id: string, name: string) => Promise<void>
  remove: (id: string) => Promise<void>
}

// Bumped on every persisted change; a save only marks "saved" if nothing changed meanwhile.
let revision = 0
let applying = false
let timer: ReturnType<typeof setTimeout> | undefined
let saveChain: Promise<void> = Promise.resolve()

const toast = (...a: Parameters<ReturnType<typeof useUi.getState>['toast']>) => useUi.getState().toast(...a)
const errMsg = (err: unknown) => (err instanceof Error ? err.message : String(err))

/** Upgrade older project files in memory; they're saved in the new format on the next save. */
function migrate(p: ProjectFile): ProjectFile {
  if ((p.version ?? 1) < 2) {
    // v1 stored caption words in timeline time; v2 stores source time (lib/timelineWords.ts).
    for (const doc of Object.values(p.data.docs)) {
      const first = [...doc.video].sort((a, b) => a.start - b.start)[0]
      const offset = first ? first.srcStart - first.start : 0
      doc.words = doc.words.map((w) => ({ ...w, start: w.start + offset, end: w.end + offset }))
    }
    p.version = 2
  }
  return p
}

function nextUntitledName(recent: ProjectMeta[]) {
  const used = new Set(recent.map((p) => p.name))
  let n = 1
  while (used.has(`Untitled project ${n}`)) n++
  return `Untitled project ${n}`
}

async function thumbnailFor(): Promise<string | undefined> {
  const { data, media, activeClipId } = useEditor.getState()
  const clip = data.clips.find((c) => c.id === activeClipId) ?? data.clips[0]
  const asset = media.find((m) => m.id === (clip?.mediaId ?? media[0]?.id))
  if (!asset || asset.status !== 'ready') return undefined
  const at = clip ? clip.srcStart + 1 : Math.min(2, asset.duration / 2)
  // Never let a slow/broken video block saving.
  const timeout = new Promise<undefined>((r) => setTimeout(() => r(undefined), 1500))
  return Promise.race([grabFrame(asset.src, at, 320).catch(() => undefined), timeout])
}

function snapshot(id: string, createdAt: number, thumbnail?: string): ProjectFile {
  const s = useEditor.getState()
  return {
    version: PROJECT_VERSION,
    id,
    name: s.projectName.trim() || 'Untitled project',
    createdAt,
    updatedAt: Date.now(),
    aspect: s.aspect,
    // Bundled/sample media keep their src; local files are re-resolved from `path` on open.
    media: s.media.map((m) => ({ ...m, src: m.path ? '' : m.src, status: m.status === 'processing' ? 'ready' : m.status })),
    music: s.music.map((m) => ({ ...m, src: m.path ? '' : m.src, status: m.status === 'processing' ? 'ready' : m.status })),
    data: s.data,
    activeClipId: s.activeClipId,
    thumbnail,
  }
}

export const useProject = create<ProjectSession>((set, get) => {
  /** Persist the editor's current state. Saves run one at a time. */
  const persist = () => {
    saveChain = saveChain.then(async () => {
      const { projectId, createdAt } = get()
      if (!projectId) return
      const rev = revision
      set({ status: 'saving' })
      try {
        await storage.save(snapshot(projectId, createdAt, await thumbnailFor()))
        if (rev === revision) set({ status: 'saved', lastSavedAt: Date.now(), error: null })
        else set({ status: 'dirty' })
      } catch (err) {
        console.error('[projects] save failed', err)
        set({ status: 'error', error: errMsg(err) })
        toast({ kind: 'error', title: 'Could not save project', body: errMsg(err) })
      }
    })
    return saveChain
  }

  /** Save pending changes before leaving the current project. */
  const flush = async () => {
    clearTimeout(timer)
    if (get().projectId && get().status !== 'saved') await persist()
  }

  const enterEditor = (p: ProjectFile) => {
    applying = true
    useEditor.getState().loadProject({ name: p.name, aspect: p.aspect, media: p.media, music: p.music, data: p.data, activeClipId: p.activeClipId })
    applying = false
    set({ view: 'editor', projectId: p.id, createdAt: p.createdAt, status: 'saved', lastSavedAt: p.updatedAt, error: null })
    useUi.getState().setLeftTab(p.data.clips.length ? 'clips' : 'media')
  }

  // Autosave: any persisted editor change marks the project dirty and schedules a save.
  useEditor.subscribe((s, prev) => {
    if (applying || get().view !== 'editor' || !get().projectId) return
    if (s.data === prev.data && s.projectName === prev.projectName && s.aspect === prev.aspect && s.media === prev.media && s.music === prev.music && s.activeClipId === prev.activeClipId) return
    revision++
    if (get().status !== 'saving') set({ status: 'dirty' })
    clearTimeout(timer)
    timer = setTimeout(persist, AUTOSAVE_MS)
  })

  return {
    view: 'home',
    projectId: null,
    createdAt: 0,
    status: 'saved',
    lastSavedAt: null,
    error: null,
    recent: [],
    loadingList: true,

    refreshList: async () => {
      set({ loadingList: true })
      try {
        set({ recent: await storage.list() })
      } catch (err) {
        console.error('[projects] list failed', err)
        toast({ kind: 'error', title: 'Could not read projects', body: errMsg(err) })
      } finally {
        set({ loadingList: false })
      }
    },

    newProject: async ({ sample = false } = {}) => {
      await flush()
      const now = Date.now()
      const clips = sample ? mockClips(8) : []
      const p: ProjectFile = {
        version: PROJECT_VERSION,
        id: uid('proj'),
        name: sample ? 'Sample · Podcast Ep. 42' : nextUntitledName(get().recent),
        createdAt: now,
        updatedAt: now,
        aspect: '9:16',
        media: sample ? [SAMPLE_MEDIA] : [],
        data: buildData(clips),
        activeClipId: clips[0]?.id ?? null,
      }
      enterEditor(p)
      await persist() // so it shows up in the projects list immediately
    },

    openProject: async (id) => {
      if (id === get().projectId && get().view === 'editor') return
      await flush()
      try {
        const p = migrate(await storage.load(id))
        const media = await Promise.all(p.media.map((m) => storage.resolveMedia(m)))
        const music = await Promise.all((p.music ?? []).map(async (m) => ({ ...m, ...(await storage.resolveMedia({ ...m, duration: m.duration })) })))
        enterEditor({ ...p, media, music })
        const missing = media.filter((m) => m.status === 'missing').length
        if (missing) toast({ kind: 'error', title: `${missing} video${missing > 1 ? 's' : ''} not found`, body: 'They were moved or deleted. Re-import them in Media.' })
      } catch (err) {
        console.error('[projects] open failed', id, err)
        toast({ kind: 'error', title: 'Could not open project', body: errMsg(err) })
      }
    },

    save: async () => {
      if (!get().projectId) return
      clearTimeout(timer)
      await persist()
      if (get().status === 'saved') toast({ kind: 'success', title: 'Project saved' })
    },

    goHome: async () => {
      await flush()
      useEditor.getState().setPlaying(false)
      set({ view: 'home', projectId: null })
      await get().refreshList()
    },

    duplicate: async (id) => {
      try {
        if (id === get().projectId) await flush()
        const p = await storage.load(id)
        const now = Date.now()
        await storage.save({ ...p, id: uid('proj'), name: `${p.name} (copy)`, createdAt: now, updatedAt: now })
        await get().refreshList()
        toast({ kind: 'success', title: 'Project duplicated', body: `${p.name} (copy)` })
      } catch (err) {
        toast({ kind: 'error', title: 'Could not duplicate project', body: errMsg(err) })
      }
    },

    rename: async (id, name) => {
      const clean = name.trim()
      if (!clean) return
      if (id === get().projectId) {
        useEditor.getState().setProjectName(clean)
        return
      }
      try {
        const p = await storage.load(id)
        await storage.save({ ...p, name: clean, updatedAt: Date.now() })
        await get().refreshList()
      } catch (err) {
        toast({ kind: 'error', title: 'Could not rename project', body: errMsg(err) })
      }
    },

    remove: async (id) => {
      try {
        await storage.remove(id)
        await get().refreshList()
        toast({ kind: 'info', title: 'Project deleted', body: storage.kind === 'desktop' ? 'Moved to the Recycle Bin / Trash.' : undefined })
      } catch (err) {
        toast({ kind: 'error', title: 'Could not delete project', body: errMsg(err) })
      }
    },
  }
})

/** Save before the desktop window closes. */
window.clipforge?.onFlushRequest(async () => {
  clearTimeout(timer)
  const { projectId, status } = useProject.getState()
  if (projectId && status !== 'saved') await useProject.getState().save()
})
