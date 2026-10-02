import { useEffect, useState } from 'react'
import { AlertCircle, Loader2, X } from 'lucide-react'
import { Button } from '../../components/ui/controls'
import { useEditor } from '../../stores/editorStore'
import { cancelJob, JobCancelledError, runJob } from '../../lib/backend'
import { buildRenderSpec } from '../../lib/renderSpec'

interface RenderResult {
  path: string
  width: number
  height: number
  duration: number
  encoder: string
}

/**
 * Renders the open clip with FFmpeg exactly as export will (framing, burned-in captions,
 * text layers, progress bar) and plays it, so you can compare it with the live preview.
 */
export function RenderCheckDialog({ onClose }: { onClose: () => void }) {
  const clipId = useEditor((s) => s.activeClipId)
  const aspect = useEditor((s) => s.aspect)
  const [job, setJob] = useState<{ id: string; progress: number; stage: string } | null>(null)
  const [result, setResult] = useState<{ src: string; info: RenderResult; seconds: number } | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    if (!clipId) return
    let alive = true
    const t0 = performance.now()
    ;(async () => {
      try {
        const spec = buildRenderSpec(clipId)
        const info = await runJob<RenderResult>('/jobs/render-clip', spec, (j) => alive && setJob({ id: j.id, progress: j.progress, stage: j.stage }))
        const src = await window.clipforge!.registerMedia(info.path)
        if (!src) throw new Error('The rendered file could not be opened.')
        if (alive) setResult({ src, info, seconds: (performance.now() - t0) / 1000 })
      } catch (err) {
        if (alive && !(err instanceof JobCancelledError)) setError(err instanceof Error ? err.message : String(err))
      }
    })()
    return () => {
      alive = false
    }
  }, [clipId])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  })

  const close = () => {
    if (job && !result && !error) cancelJob(job.id).catch(() => undefined)
    onClose()
  }

  const ratio = aspect === '9:16' ? '9 / 16' : aspect === '1:1' ? '1 / 1' : '16 / 9'

  return (
    <div className="fixed inset-0 z-40 flex animate-fade-in items-center justify-center bg-black/70 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && close()}>
      <div className="flex max-h-[92vh] w-[min(560px,92vw)] flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-3.5">
          <div>
            <h2 className="text-[15px] font-semibold">Render check</h2>
            <p className="text-xs text-muted">The real FFmpeg output with burned-in captions — compare it with the live preview.</p>
          </div>
          <button onClick={close} className="text-muted hover:text-fg" aria-label="Close"><X size={18} /></button>
        </div>
        <div className="flex min-h-0 flex-1 flex-col items-center gap-3 overflow-y-auto p-5">
          {error ? (
            <div className="flex flex-col items-center gap-2 py-10 text-center">
              <AlertCircle className="text-bad" size={26} />
              <div className="text-[13px] font-medium">Render failed</div>
              <div className="max-w-sm text-xs leading-relaxed text-muted">{error}</div>
            </div>
          ) : result ? (
            <>
              <video src={result.src} controls autoPlay className="max-h-[68vh] rounded-xl bg-black" style={{ aspectRatio: ratio }} />
              <div className="text-xs text-faint">
                {result.info.width}×{result.info.height} · {result.info.duration.toFixed(1)} s · {result.info.encoder === 'h264_nvenc' ? 'GPU (NVENC)' : result.info.encoder === 'h264_videotoolbox' ? 'GPU (VideoToolbox)' : 'CPU (x264)'} · rendered in {result.seconds.toFixed(1)} s
              </div>
            </>
          ) : (
            <div className="flex w-full flex-col items-center gap-3 py-12">
              <Loader2 className="animate-spin text-accent" size={26} />
              <div className="text-[13px]">{job?.stage ?? 'Starting'}…</div>
              <div className="h-1 w-64 overflow-hidden rounded-full bg-raised">
                <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${(job?.progress ?? 0) * 100}%` }} />
              </div>
              <p className="max-w-xs text-center text-[11px] text-faint">The first render prepares the caption fonts, which takes a little longer.</p>
            </div>
          )}
        </div>
        <div className="flex justify-end border-t border-line px-5 py-3">
          <Button onClick={close}>{result || error ? 'Close' : 'Cancel'}</Button>
        </div>
      </div>
    </div>
  )
}
