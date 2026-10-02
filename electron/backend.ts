// Starts and supervises the Python backend (FastAPI) as a child process.
// It listens on 127.0.0.1 only, on a free port, and requires a per-launch token.
import { app } from 'electron'
import { spawn, type ChildProcess } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import net from 'node:net'
import path from 'node:path'

export type BackendStatus = 'starting' | 'ready' | 'unavailable' | 'crashed'

interface BackendState {
  status: BackendStatus
  url: string | null
  token: string
  error: string | null
}

const state: BackendState = { status: 'starting', url: null, token: randomBytes(24).toString('hex'), error: null }
let child: ChildProcess | null = null
let restarts = 0
let quitting = false

const MAX_RESTARTS = 3
const backendDir = () => path.join(app.getAppPath(), 'backend')
const pythonPath = () =>
  process.platform === 'win32'
    ? path.join(backendDir(), '.venv', 'Scripts', 'python.exe')
    : path.join(backendDir(), '.venv', 'bin', 'python')

/**
 * How to launch the backend. Installed app: the PyInstaller build plus bundled FFmpeg and
 * fonts under resources/. Development: backend/.venv's Python with the system FFmpeg.
 */
function launchSpec(port: number): { cmd: string; args: string[]; cwd: string; env: NodeJS.ProcessEnv } | { missing: string } {
  const env: NodeJS.ProcessEnv = {
    ...process.env,
    CLIPFORGE_DATA_DIR: app.getPath('userData'),
    CLIPFORGE_PARENT_PID: String(process.pid),
    CLIPFORGE_TOKEN: state.token,
    PYTHONUNBUFFERED: '1',
    PYTHONIOENCODING: 'utf-8',
  }
  if (app.isPackaged) {
    const res = process.resourcesPath
    const exe = path.join(res, 'backend', process.platform === 'win32' ? 'clipforge-backend.exe' : 'clipforge-backend')
    if (!existsSync(exe)) return { missing: `The ClipForge backend is missing from the installation (${exe}). Please reinstall.` }
    env.PATH = `${path.join(res, 'ffmpeg')}${path.delimiter}${process.env.PATH ?? ''}`
    env.CLIPFORGE_FONTS_DIR = path.join(res, 'fonts')
    return { cmd: exe, args: ['--port', String(port)], cwd: path.dirname(exe), env }
  }
  const python = pythonPath()
  if (!existsSync(python)) return { missing: 'The Python backend is not set up. Run `npm run setup:backend`, then restart ClipForge.' }
  return { cmd: python, args: ['-m', 'clipforge.main', '--port', String(port)], cwd: backendDir(), env }
}

export const backendInfo = () => ({ ...state })

function freePort(): Promise<number> {
  return new Promise((resolve, reject) => {
    const srv = net.createServer()
    srv.unref()
    srv.on('error', reject)
    srv.listen(0, '127.0.0.1', () => {
      const { port } = srv.address() as net.AddressInfo
      srv.close(() => resolve(port))
    })
  })
}

async function waitForHealth(url: string, timeoutMs: number) {
  const t0 = Date.now()
  while (Date.now() - t0 < timeoutMs) {
    if (!child || child.exitCode !== null) return false
    try {
      if ((await fetch(`${url}/health`)).ok) return true
    } catch {
      // not listening yet
    }
    await new Promise((r) => setTimeout(r, 300))
  }
  return false
}

export async function startBackend() {
  const port = await freePort()
  const launch = launchSpec(port)
  if ('missing' in launch) {
    state.status = 'unavailable'
    state.error = launch.missing
    console.warn(`[backend] ${state.error}`)
    return
  }
  state.status = 'starting'
  state.url = `http://127.0.0.1:${port}`
  state.error = null

  child = spawn(launch.cmd, launch.args, {
    cwd: launch.cwd,
    env: launch.env,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  })
  child.stdout?.on('data', (d) => process.stdout.write(`[backend] ${d}`))
  child.stderr?.on('data', (d) => process.stderr.write(`[backend] ${d}`))
  child.on('error', (err) => {
    state.status = 'crashed'
    state.error = `Could not start the backend: ${err.message}`
    console.error('[backend]', err)
  })
  child.on('exit', (code, signal) => {
    child = null
    if (quitting) return
    console.error(`[backend] exited (code ${code}, signal ${signal})`)
    state.status = 'crashed'
    state.error = `The backend stopped unexpectedly (exit code ${code}). See the log in the app data folder.`
    if (restarts < MAX_RESTARTS) {
      restarts++
      setTimeout(() => void startBackend(), 1500)
    }
  })

  if (await waitForHealth(state.url, 30_000)) {
    state.status = 'ready'
    restarts = 0
    console.log(`[backend] ready at ${state.url}`)
  } else if (state.status === 'starting') {
    state.status = 'crashed'
    state.error = 'The backend did not start within 30 seconds.'
    child?.kill()
  }
}

export function stopBackend() {
  quitting = true
  child?.kill()
}

/** Restart to pick up new settings (API key, GPU libraries). */
export async function restartBackend() {
  const old = child
  if (old) {
    quitting = true // don't treat this exit as a crash
    await new Promise<void>((resolve) => {
      old.once('exit', () => resolve())
      old.kill()
      setTimeout(resolve, 5000)
    })
    quitting = false
  }
  restarts = 0
  await startBackend()
}
