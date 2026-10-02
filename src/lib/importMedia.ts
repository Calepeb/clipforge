import { useEditor } from '../stores/editorStore'
import { useUi } from '../stores/uiStore'
import type { MediaAsset } from '../types/editor'
import { blobAlive } from './projectStorage'
import { probeVideo } from './media'
import { uid } from './time'

export const ACCEPTED_VIDEO = /\.(mp4|mov|m4v|webm)$/i

/**
 * Adds dropped/picked video files to the current project. In the desktop app the
 * file path is stored so the project can reopen it later; in the browser a blob URL
 * is used for this session only.
 */
export async function importVideoFiles(files: FileList | File[]) {
  const { addMedia, updateMedia } = useEditor.getState()
  const { toast } = useUi.getState()
  const list = [...files]
  const valid = list.filter((f) => ACCEPTED_VIDEO.test(f.name))
  if (valid.length < list.length) toast({ kind: 'error', title: 'Some files were skipped', body: 'ClipForge imports MP4, MOV, M4V and WebM video.' })

  await Promise.all(
    valid.map(async (file) => {
      const api = window.clipforge
      const path = api?.getPathForFile(file) || undefined
      let src: string | null = null
      if (api && path) src = await api.registerMedia(path)
      if (!src) {
        src = URL.createObjectURL(file)
        blobAlive.add(src)
      }
      const asset: MediaAsset = { id: uid('media'), name: file.name, src, path, duration: 0, status: 'processing' }
      addMedia(asset)
      try {
        const meta = await probeVideo(src)
        updateMedia(asset.id, { ...meta, status: 'ready' })
        toast({ kind: 'success', title: 'Imported', body: file.name })
      } catch (err) {
        console.error('[import] could not read video', file.name, err)
        updateMedia(asset.id, { status: 'missing' })
        toast({ kind: 'error', title: 'Could not read video', body: file.name })
      }
    }),
  )
}

export const ACCEPTED_AUDIO = /\.(mp3|m4a|aac|wav|ogg|flac)$/i

function probeAudio(src: string): Promise<number> {
  return new Promise((resolve, reject) => {
    const a = new Audio()
    a.preload = 'metadata'
    a.onloadedmetadata = () => resolve(a.duration)
    a.onerror = () => reject(new Error('unreadable audio'))
    a.src = src
  })
}

/** Adds music files to the project (Audio tab). Same path/blob handling as videos. */
export async function importMusicFiles(files: FileList | File[]) {
  const { addMusic, updateMusic } = useEditor.getState()
  const { toast } = useUi.getState()
  const list = [...files]
  const valid = list.filter((f) => ACCEPTED_AUDIO.test(f.name))
  if (valid.length < list.length) toast({ kind: 'error', title: 'Some files were skipped', body: 'Music can be MP3, M4A, AAC, WAV, OGG or FLAC.' })
  await Promise.all(
    valid.map(async (file) => {
      const api = window.clipforge
      const path = api?.getPathForFile(file) || undefined
      let src = api && path ? await api.registerMedia(path) : null
      if (!src) {
        src = URL.createObjectURL(file)
        blobAlive.add(src)
      }
      const id = uid('music')
      addMusic({ id, name: file.name.replace(/\.[^.]+$/, ''), src, path, duration: 0, status: 'processing' })
      try {
        updateMusic(id, { duration: await probeAudio(src), status: 'ready' })
      } catch (err) {
        console.error('[import] could not read audio', file.name, err)
        updateMusic(id, { status: 'missing' })
        toast({ kind: 'error', title: 'Could not read audio', body: file.name })
      }
    }),
  )
}
