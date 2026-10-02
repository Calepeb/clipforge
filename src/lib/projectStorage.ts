// Where projects live. Desktop: JSON files via Electron IPC. Browser (`dev:web`): localStorage.
import type { MediaAsset } from '../types/editor'
import type { ProjectFile, ProjectMeta } from '../types/project'

export interface ProjectStorage {
  kind: 'desktop' | 'browser'
  list(): Promise<ProjectMeta[]>
  load(id: string): Promise<ProjectFile>
  save(p: ProjectFile): Promise<void>
  remove(id: string): Promise<void>
  openFolder?: () => void
  /** Make a saved media entry playable again (or mark it missing). */
  resolveMedia(m: MediaAsset): Promise<MediaAsset>
}

const desktop = (api: NonNullable<Window['clipforge']>): ProjectStorage => ({
  kind: 'desktop',
  list: () => api.projects.list(),
  load: (id) => api.projects.load(id),
  save: (p) => api.projects.save(p),
  remove: (id) => api.projects.remove(id),
  openFolder: () => void api.projects.openFolder(),
  async resolveMedia(m) {
    if (!m.path) return m
    const src = await api.registerMedia(m.path)
    return src ? { ...m, src, status: 'ready' } : { ...m, src: '', status: 'missing' }
  },
})

const KEY = 'cf.project.'

const browser: ProjectStorage = {
  kind: 'browser',
  async list() {
    const metas: ProjectMeta[] = []
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i)
      if (!k?.startsWith(KEY)) continue
      try {
        const p = JSON.parse(localStorage.getItem(k)!) as ProjectFile
        metas.push({ id: p.id, name: p.name, createdAt: p.createdAt, updatedAt: p.updatedAt, thumbnail: p.thumbnail, clipCount: p.data.clips.length, mediaCount: p.media.length })
      } catch (err) {
        console.error('[projects] skipping unreadable entry', k, err)
      }
    }
    return metas.sort((a, b) => b.updatedAt - a.updatedAt)
  },
  async load(id) {
    const raw = localStorage.getItem(KEY + id)
    if (!raw) throw new Error('Project not found')
    return JSON.parse(raw)
  },
  async save(p) {
    localStorage.setItem(KEY + p.id, JSON.stringify(p))
  },
  async remove(id) {
    localStorage.removeItem(KEY + id)
  },
  // Blob URLs die with the page, so browser-imported videos can't be reopened.
  async resolveMedia(m) {
    return m.src.startsWith('blob:') && !blobAlive.has(m.src) ? { ...m, src: '', status: 'missing' } : m
  },
}

/** Blob URLs created in this page session (still playable). */
export const blobAlive = new Set<string>()

export const storage: ProjectStorage = window.clipforge ? desktop(window.clipforge) : browser
