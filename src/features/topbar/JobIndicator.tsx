import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { CheckCircle2, Loader2, ListChecks, XCircle } from 'lucide-react'
import { useUi } from '../../stores/uiStore'

export function JobIndicator() {
  const jobs = useUi((s) => s.jobs)
  const clear = useUi((s) => s.clearFinishedJobs)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const running = jobs.filter((j) => j.status === 'running')
  const avg = running.length ? running.reduce((a, j) => a + j.progress, 0) / running.length : 0

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={clsx(
          'flex h-8 items-center gap-2 rounded-lg px-2.5 text-xs transition-colors',
          running.length ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-fg',
        )}
        title="Background jobs"
      >
        {running.length ? <Loader2 size={15} className="animate-spin" /> : <ListChecks size={15} />}
        {running.length ? `${running.length} running · ${Math.round(avg * 100)}%` : 'Jobs'}
      </button>
      {open && (
        <div className="absolute right-0 top-10 z-40 w-80 animate-fade-in rounded-xl border border-line-strong bg-panel-2 p-2 shadow-2xl">
          <div className="flex items-center justify-between px-2 py-1.5">
            <span className="text-xs font-semibold uppercase tracking-wide text-muted">Background jobs</span>
            {jobs.some((j) => j.status !== 'running') && (
              <button onClick={clear} className="text-xs text-muted hover:text-fg">
                Clear finished
              </button>
            )}
          </div>
          {jobs.length === 0 && <div className="px-2 py-6 text-center text-xs text-faint">No jobs yet</div>}
          <div className="flex max-h-80 flex-col gap-1 overflow-y-auto">
            {[...jobs].reverse().map((j) => (
              <div key={j.id} className="rounded-lg px-2 py-2 hover:bg-raised">
                <div className="flex items-center gap-2">
                  {j.status === 'done' ? <CheckCircle2 size={14} className="text-good" /> : j.status === 'running' ? <Loader2 size={14} className="animate-spin text-accent" /> : <XCircle size={14} className={j.status === 'error' ? 'text-bad' : 'text-faint'} />}
                  <span className="flex-1 truncate text-[13px]">{j.label}</span>
                  <span className="text-xs tabular-nums text-muted">{Math.round(j.progress * 100)}%</span>
                </div>
                <div className="mt-1.5 text-[11px] text-faint">{j.status === 'done' ? 'Completed' : j.status === 'cancelled' ? 'Cancelled' : j.stage}</div>
                <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-raised">
                  <div className={clsx('h-full rounded-full transition-[width]', j.status === 'done' ? 'bg-good' : j.status === 'error' ? 'bg-bad' : j.status === 'cancelled' ? 'bg-faint' : 'bg-accent')} style={{ width: `${j.progress * 100}%` }} />
                </div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
