import { Check, Download, Loader2, RefreshCw, RotateCcw } from 'lucide-react'
import { Button } from '../../components/ui/controls'
import { useUpdates } from '../../stores/updateStore'

/** Settings → Updates: check, download with progress, restart to install. */
export function UpdatesSection() {
  const s = useUpdates((st) => st.status)
  const api = window.clipforge?.updates
  if (!api || !s) return null

  let body
  switch (s.state) {
    case 'disabled':
      body = <p className="text-xs leading-relaxed text-muted">{s.reason}</p>
      break
    case 'checking':
      body = <p className="flex items-center gap-2 text-xs text-muted"><Loader2 size={13} className="animate-spin" /> Checking for updates…</p>
      break
    case 'available':
      body = (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-fg">ClipForge <b>{s.newVersion}</b> is available.</p>
          <Button size="sm" variant="primary" onClick={() => api.download()}><Download size={14} /> Download</Button>
        </div>
      )
      break
    case 'downloading':
      body = (
        <div className="flex flex-col gap-1.5">
          <div className="flex justify-between text-xs text-muted"><span>Downloading {s.newVersion}…</span><span className="tabular-nums">{Math.round(s.percent)}%</span></div>
          <div className="h-1 overflow-hidden rounded-full bg-raised"><div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${s.percent}%` }} /></div>
        </div>
      )
      break
    case 'downloaded':
      body = (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-fg">Version <b>{s.newVersion}</b> is ready. Your projects are saved first.</p>
          <Button size="sm" variant="primary" onClick={() => api.install()}><RotateCcw size={14} /> Restart to update</Button>
        </div>
      )
      break
    case 'error':
      body = (
        <div className="flex items-center justify-between gap-3">
          <p className="text-xs text-bad">{s.message}</p>
          <Button size="sm" onClick={() => api.check()}><RefreshCw size={14} /> Retry</Button>
        </div>
      )
      break
    default:
      body = (
        <div className="flex items-center justify-between gap-3">
          <p className="flex items-center gap-1.5 text-xs text-muted">
            {s.state === 'not-available' && <Check size={13} className="text-good" />}
            {s.state === 'not-available' ? 'You’re on the latest version.' : 'ClipForge checks for updates automatically.'}
          </p>
          <Button size="sm" onClick={() => api.check()}><RefreshCw size={14} /> Check now</Button>
        </div>
      )
  }

  return (
    <section className="flex flex-col gap-3 p-5">
      <div className="flex items-center gap-2 text-[13px] font-semibold"><RefreshCw size={15} className="text-accent" /> Updates</div>
      {body}
    </section>
  )
}

/** Small notice on the Projects screen when an update can be installed. */
export function UpdateNotice({ onOpen }: { onOpen: () => void }) {
  const s = useUpdates((st) => st.status)
  if (!s || (s.state !== 'available' && s.state !== 'downloaded' && s.state !== 'downloading')) return null
  const label = s.state === 'downloaded' ? `Restart to update to ${s.newVersion}` : s.state === 'downloading' ? `Downloading update… ${Math.round(s.percent)}%` : `Update ${s.newVersion} available`
  return (
    <button onClick={onOpen} className="flex h-7 items-center gap-1.5 rounded-full bg-accent-soft px-3 text-xs font-medium text-accent transition-colors hover:bg-accent hover:text-white">
      <Download size={13} /> {label}
    </button>
  )
}
