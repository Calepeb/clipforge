// Serves local video files to the renderer through the `cf-media://` protocol.
// Only files registered through IPC (imported by the user or referenced by an
// opened project) are served, and only media/font/image extensions are accepted.
import { protocol } from 'electron'
import fs from 'node:fs'
import path from 'node:path'
import { Readable } from 'node:stream'

export const MEDIA_SCHEME = 'cf-media'

const MIME: Record<string, string> = {
  '.mp4': 'video/mp4',
  '.m4v': 'video/mp4',
  '.mov': 'video/quicktime',
  '.webm': 'video/webm',
  // music
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.aac': 'audio/aac',
  '.wav': 'audio/wav',
  '.ogg': 'audio/ogg',
  '.flac': 'audio/flac',
  // brand kit
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.ttf': 'font/ttf',
  '.otf': 'font/otf',
}

const allowed = new Set<string>()

/** Must run before app `ready`. */
export function registerMediaScheme() {
  protocol.registerSchemesAsPrivileged([
    { scheme: MEDIA_SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, stream: true, corsEnabled: true } },
  ])
}

/** Allow a file to be served; returns its URL, or null if it is missing or not a video. */
export async function registerMedia(filePath: string): Promise<string | null> {
  const resolved = path.resolve(filePath)
  if (!MIME[path.extname(resolved).toLowerCase()]) return null
  try {
    if (!(await fs.promises.stat(resolved)).isFile()) return null
  } catch {
    return null
  }
  allowed.add(resolved)
  return `${MEDIA_SCHEME}://file/${encodeURIComponent(resolved)}`
}

/** Streams registered files with HTTP Range support so the <video> element can seek. */
export function handleMediaProtocol() {
  protocol.handle(MEDIA_SCHEME, async (req) => {
    const filePath = path.resolve(decodeURIComponent(new URL(req.url).pathname.slice(1)))
    if (!allowed.has(filePath)) return new Response('Forbidden', { status: 403 })

    let size: number
    try {
      size = (await fs.promises.stat(filePath)).size
    } catch (err) {
      console.error('[media] file vanished:', filePath, err)
      return new Response('Not found', { status: 404 })
    }

    const headers: Record<string, string> = {
      'Content-Type': MIME[path.extname(filePath).toLowerCase()],
      'Accept-Ranges': 'bytes',
      'Access-Control-Allow-Origin': '*',
    }
    const stream = (start: number, end: number) =>
      Readable.toWeb(fs.createReadStream(filePath, { start, end })) as unknown as ReadableStream

    const m = /^bytes=(\d*)-(\d*)$/.exec(req.headers.get('range') ?? '')
    if (m && (m[1] || m[2])) {
      let start: number
      let end: number
      if (m[1]) {
        start = +m[1]
        end = m[2] ? Math.min(+m[2], size - 1) : size - 1
      } else {
        start = Math.max(0, size - +m[2]) // suffix range: last N bytes
        end = size - 1
      }
      if (start > end || start >= size) {
        return new Response(null, { status: 416, headers: { ...headers, 'Content-Range': `bytes */${size}` } })
      }
      return new Response(stream(start, end), {
        status: 206,
        headers: { ...headers, 'Content-Range': `bytes ${start}-${end}/${size}`, 'Content-Length': String(end - start + 1) },
      })
    }
    return new Response(stream(0, size - 1), { status: 200, headers: { ...headers, 'Content-Length': String(size) } })
  })
}
