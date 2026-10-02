import clsx from 'clsx'
import { CheckCircle2, Info, X, XCircle } from 'lucide-react'
import { useUi } from '../../stores/uiStore'

const ICON = { info: Info, success: CheckCircle2, error: XCircle }
const COLOR = { info: 'text-track-video', success: 'text-good', error: 'text-bad' }

export function Toaster() {
  const toasts = useUi((s) => s.toasts)
  const dismiss = useUi((s) => s.dismissToast)
  return (
    <div className="pointer-events-none fixed bottom-5 right-5 z-50 flex w-80 flex-col gap-2">
      {toasts.map((t) => {
        const Icon = ICON[t.kind]
        return (
          <div key={t.id} role="status" className="pointer-events-auto flex animate-toast-in gap-3 rounded-xl border border-line-strong bg-panel-2/95 p-3 shadow-2xl backdrop-blur">
            <Icon size={18} className={clsx('mt-0.5 shrink-0', COLOR[t.kind])} />
            <div className="min-w-0 flex-1">
              <div className="font-medium">{t.title}</div>
              {t.body && <div className="mt-0.5 text-xs text-muted">{t.body}</div>}
            </div>
            <button onClick={() => dismiss(t.id)} className="text-faint hover:text-fg" aria-label="Dismiss">
              <X size={14} />
            </button>
          </div>
        )
      })}
    </div>
  )
}
