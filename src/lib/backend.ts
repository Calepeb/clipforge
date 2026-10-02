// Client for the Python backend: REST with a token header + one WebSocket for job progress.
import { useUi } from '../stores/uiStore'

export interface BackendJob<R = unknown> {
  id: string
  kind: string
  label: string
  status: 'running' | 'done' | 'error' | 'cancelled'
  stage: string
  progress: number
  error: string | null
  result: R | null
}

export class BackendUnavailable extends Error {}

interface Conn {
  url: string
  token: string
}

let conn: Promise<Conn> | null = null
let socket: WebSocket | null = null
const listeners = new Map<string, (job: BackendJob) => void>()

/** True when running inside the desktop app (the backend may still be starting). */
export const hasBackend = () => !!window.clipforge

async function connect(): Promise<Conn> {
  const api = window.clipforge
  if (!api) throw new BackendUnavailable('AI features need the desktop app (npm run dev).')
  // The backend can take a few seconds to boot; wait up to ~40s.
  for (let i = 0; i < 80; i++) {
    const info = await api.backendInfo()
    if (info.status === 'ready' && info.url) return { url: info.url, token: info.token }
    if (info.status === 'unavailable') throw new BackendUnavailable(info.error ?? 'Backend unavailable')
    if (info.status === 'crashed' && i > 10) throw new BackendUnavailable(info.error ?? 'Backend crashed')
    await new Promise((r) => setTimeout(r, 500))
  }
  throw new BackendUnavailable('The backend is taking too long to start.')
}

function getConn() {
  conn ??= connect().catch((err) => {
    conn = null // allow a retry next time
    throw err
  })
  return conn
}

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const { url, token } = await getConn()
  const res = await fetch(url + path, {
    ...init,
    headers: { 'content-type': 'application/json', 'x-clipforge-token': token, ...init.headers },
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.detail ?? `Backend error ${res.status}`)
  return body as T
}

async function ensureSocket() {
  if (socket && socket.readyState <= WebSocket.OPEN) return
  const { url, token } = await getConn()
  socket = new WebSocket(`${url.replace('http', 'ws')}/ws?token=${encodeURIComponent(token)}`)
  socket.onmessage = (e) => {
    const msg = JSON.parse(e.data)
    if (msg.type !== 'job') return
    const job = msg.job as BackendJob
    // Mirror every backend job into the top-bar job indicator.
    useUi.getState().upsertJob({
      id: job.id,
      label: job.label,
      stage: job.error ?? job.stage,
      progress: job.progress,
      status: job.status,
    })
    listeners.get(job.id)?.(job)
  }
  socket.onclose = () => {
    socket = null
    // Reconnect while jobs are in flight so progress keeps flowing.
    if (listeners.size) setTimeout(() => void ensureSocket(), 1000)
  }
  await new Promise<void>((resolve, reject) => {
    socket!.addEventListener('open', () => resolve(), { once: true })
    socket!.addEventListener('error', () => reject(new Error('Could not connect to the backend')), { once: true })
  })
}

/** Starts a backend job and resolves with its result once it finishes. */
export async function runJob<R>(path: string, body: unknown, onUpdate?: (job: BackendJob<R>) => void): Promise<R> {
  await ensureSocket()
  const started = await request<BackendJob<R>>(path, { method: 'POST', body: JSON.stringify(body) })
  return new Promise<R>((resolve, reject) => {
    const handle = (job: BackendJob) => {
      onUpdate?.(job as BackendJob<R>)
      if (job.status === 'running') return
      listeners.delete(job.id)
      if (job.status === 'done') resolve(job.result as R)
      else if (job.status === 'cancelled') reject(new JobCancelledError())
      else reject(new Error(job.error ?? 'Job failed'))
    }
    listeners.set(started.id, handle)
    handle(started)
  })
}

export class JobCancelledError extends Error {
  constructor() {
    super('Cancelled')
  }
}

export const cancelJob = (id: string) => request(`/jobs/${id}/cancel`, { method: 'POST' })

export interface GeneratedClip {
  start: number
  end: number
  score: number
  title: string
  hook: string
  reason: string
  hashtags: string[]
  signals: import('../types/editor').ClipSignals
  words: { text: string; start: number; end: number }[]
}

export interface GenerateResult {
  language: string
  device: string
  model: string
  note: string | null
  warning: string | null
  /** Whether Claude analysed the transcript this run. */
  claude: boolean
  clips: GeneratedClip[]
  transcript: { text: string; start: number; end: number }[]
}

/** Forget the cached connection (the backend restarted on a new port). */
export function resetBackendConnection() {
  conn = null
  socket?.close()
  socket = null
}

/** GET helper for small status endpoints. */
export async function getJson<T>(path: string): Promise<T> {
  return request<T>(path)
}
