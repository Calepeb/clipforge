import { useCallback, useEffect, useState } from 'react'
import { Check, Cpu, FolderOpen, KeyRound, Loader2, X, Zap } from 'lucide-react'
import { Button } from '../../components/ui/controls'
import { useUi } from '../../stores/uiStore'
import { cancelJob, getJson, JobCancelledError, resetBackendConnection, runJob } from '../../lib/backend'
import { UpdatesSection } from './UpdatesSection'

interface SystemInfo {
  gpu: string | null
  cuda_libs: boolean
  claude_key: boolean
}

/** App settings: Claude API key, GPU acceleration, data folder. */
export function SettingsDialog() {
  const open = useUi((s) => s.settingsOpen)
  const setOpen = useUi((s) => s.setSettingsOpen)
  const toast = useUi((s) => s.toast)
  const [info, setInfo] = useState<{ hasApiKey: boolean; dataDir: string; version: string } | null>(null)
  const [system, setSystem] = useState<SystemInfo | null>(null)
  const [key, setKey] = useState('')
  const [saving, setSaving] = useState(false)
  const [gpuJob, setGpuJob] = useState<{ id: string; progress: number; stage: string } | null>(null)

  const refresh = useCallback(async () => {
    if (!window.clipforge) return
    setInfo(await window.clipforge.settings.get())
    try {
      setSystem(await getJson<SystemInfo>('/system'))
    } catch {
      setSystem(null)
    }
  }, [])

  useEffect(() => {
    if (open) void refresh()
  }, [open, refresh])

  if (!open) return null

  /** Restart the backend so it picks up the new key / GPU libraries. */
  const restart = async () => {
    resetBackendConnection()
    await window.clipforge!.settings.restartBackend()
    resetBackendConnection()
  }

  const saveKey = async (value: string) => {
    setSaving(true)
    try {
      await window.clipforge!.settings.setApiKey(value)
      resetBackendConnection()
      setKey('')
      toast({ kind: 'success', title: value ? 'Claude API key saved' : 'Claude API key removed' })
      await refresh()
    } catch (err) {
      toast({ kind: 'error', title: 'Could not save the key', body: err instanceof Error ? err.message : String(err) })
    } finally {
      setSaving(false)
    }
  }

  const enableGpu = async () => {
    try {
      await runJob('/jobs/install-gpu', {}, (j) => setGpuJob({ id: j.id, progress: j.progress, stage: j.stage }))
      await restart()
      toast({ kind: 'success', title: 'GPU acceleration enabled', body: 'Transcription now runs on your graphics card.' })
    } catch (err) {
      if (!(err instanceof JobCancelledError)) toast({ kind: 'error', title: 'GPU download failed', body: err instanceof Error ? err.message : String(err) })
    } finally {
      setGpuJob(null)
      await refresh()
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex animate-fade-in items-center justify-center bg-black/60 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="flex w-[520px] flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <h2 className="text-base font-semibold">Settings</h2>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-fg" aria-label="Close"><X size={18} /></button>
        </div>
        {!window.clipforge ? (
          <div className="p-6 text-xs text-muted">Settings are available in the desktop app.</div>
        ) : (
          <div className="flex flex-col divide-y divide-line">
            <section className="flex flex-col gap-3 p-5">
              <div className="flex items-center gap-2 text-[13px] font-semibold"><KeyRound size={15} className="text-accent" /> Claude API key</div>
              <p className="text-xs leading-relaxed text-muted">
                Lets Claude pick the most engaging moments and write hooks and titles. Get a key at console.anthropic.com.
                It's stored only on this computer, in the app data folder.
              </p>
              <div className="flex items-center gap-2">
                <input
                  type="password"
                  value={key}
                  onChange={(e) => setKey(e.target.value)}
                  placeholder={info?.hasApiKey ? '•••••••• saved — paste a new key to replace' : 'sk-ant-…'}
                  className="h-8 min-w-0 flex-1 rounded-lg border border-line bg-raised px-2.5 text-[13px] outline-none focus:border-accent"
                />
                <Button size="sm" variant="primary" disabled={!key.trim() || saving} onClick={() => saveKey(key)}>{saving ? 'Saving…' : 'Save'}</Button>
              </div>
              {info?.hasApiKey && (
                <div className="flex items-center justify-between text-xs">
                  <span className="flex items-center gap-1.5 text-good"><Check size={13} /> Key saved{system && !system.claude_key ? ' (restarting…)' : ''}</span>
                  <button onClick={() => saveKey('')} className="text-muted hover:text-bad">Remove key</button>
                </div>
              )}
            </section>

            <section className="flex flex-col gap-3 p-5">
              <div className="flex items-center gap-2 text-[13px] font-semibold"><Zap size={15} className="text-accent" /> GPU acceleration</div>
              {!system ? (
                <div className="flex items-center gap-2 text-xs text-muted"><Loader2 size={13} className="animate-spin" /> Checking…</div>
              ) : !system.gpu ? (
                <p className="flex items-center gap-2 text-xs text-muted"><Cpu size={14} /> No NVIDIA GPU found — transcription runs on the CPU.</p>
              ) : system.cuda_libs ? (
                <p className="flex items-center gap-2 text-xs text-good"><Check size={14} /> Enabled on {system.gpu}.</p>
              ) : gpuJob ? (
                <div className="flex flex-col gap-1.5">
                  <div className="flex items-center justify-between text-xs text-muted">
                    <span className="truncate">{gpuJob.stage}</span>
                    <button onClick={() => cancelJob(gpuJob.id).catch(() => undefined)} className="text-faint hover:text-fg">Cancel</button>
                  </div>
                  <div className="h-1 overflow-hidden rounded-full bg-raised"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${gpuJob.progress * 100}%` }} /></div>
                </div>
              ) : (
                <>
                  <p className="text-xs leading-relaxed text-muted">
                    Found <span className="text-fg">{system.gpu}</span>. Transcription can run several times faster on it after a one-time
                    download of NVIDIA's CUDA libraries (about 1.4 GB, from PyPI).
                  </p>
                  <Button size="sm" className="self-start" onClick={enableGpu}><Zap size={14} /> Enable GPU acceleration</Button>
                </>
              )}
            </section>

            <UpdatesSection />

            <section className="flex items-center justify-between gap-3 p-5 text-xs text-muted">
              <span className="min-w-0 truncate" title={info?.dataDir}>Data folder: <span className="font-mono">{info?.dataDir}</span></span>
              <Button size="sm" variant="ghost" onClick={() => window.clipforge!.settings.openDataDir()}><FolderOpen size={14} /> Open</Button>
            </section>
            <div className="px-5 py-2 text-right text-[11px] text-faint">ClipForge {info?.version}</div>
          </div>
        )}
      </div>
    </div>
  )
}
