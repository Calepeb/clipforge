// Project library: one JSON file per project in <userData>/projects.
// Phase 2 moves this into the backend's SQLite database; the IPC surface stays the same.
import { app, shell } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

const ID = /^[A-Za-z0-9_-]{1,64}$/
const EXT = '.clipforge.json'

/** Only the fields the main process needs; the renderer owns the full schema. */
interface StoredProject {
  id: string
  name: string
  createdAt: number
  updatedAt: number
  thumbnail?: string
  media?: unknown[]
  data?: { clips?: unknown[] }
}

export const projectsDir = () => path.join(app.getPath('userData'), 'projects')

function fileFor(id: string) {
  if (!ID.test(id)) throw new Error(`Invalid project id: ${id}`)
  return path.join(projectsDir(), id + EXT)
}

function assertProject(p: unknown): asserts p is StoredProject {
  const x = p as StoredProject
  if (!x || typeof x !== 'object' || typeof x.id !== 'string' || typeof x.name !== 'string') {
    throw new Error('Not a ClipForge project')
  }
}

export async function listProjects() {
  await fs.mkdir(projectsDir(), { recursive: true })
  const files = (await fs.readdir(projectsDir())).filter((f) => f.endsWith(EXT))
  const metas = []
  for (const f of files) {
    try {
      const p: unknown = JSON.parse(await fs.readFile(path.join(projectsDir(), f), 'utf8'))
      assertProject(p)
      metas.push({
        id: p.id,
        name: p.name,
        createdAt: p.createdAt,
        updatedAt: p.updatedAt,
        thumbnail: p.thumbnail,
        clipCount: p.data?.clips?.length ?? 0,
        mediaCount: p.media?.length ?? 0,
      })
    } catch (err) {
      console.error(`[projects] skipping unreadable file ${f}:`, err)
    }
  }
  return metas.sort((a, b) => b.updatedAt - a.updatedAt)
}

export async function loadProject(id: string) {
  const p: unknown = JSON.parse(await fs.readFile(fileFor(id), 'utf8'))
  assertProject(p)
  return p
}

/** Atomic write: a crash mid-save never leaves a half-written project. */
export async function saveProject(p: unknown) {
  assertProject(p)
  await fs.mkdir(projectsDir(), { recursive: true })
  const target = fileFor(p.id)
  const tmp = `${target}.tmp`
  await fs.writeFile(tmp, JSON.stringify(p), 'utf8')
  await fs.rename(tmp, target)
}

/** Moves the project file to the OS trash so it can be recovered. */
export async function deleteProject(id: string) {
  await shell.trashItem(fileFor(id))
}
