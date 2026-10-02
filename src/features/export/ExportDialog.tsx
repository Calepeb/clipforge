import { useEffect, useState } from 'react'
import clsx from 'clsx'
import { AlertCircle, Ban, Check, CheckCircle2, FolderOpen, Loader2, RotateCcw, X } from 'lucide-react'
import { useEditor } from '../../stores/editorStore'
import { useUi } from '../../stores/uiStore'
import { useExport, type ExportItem } from '../../stores/exportStore'
import { formatDuration, safeFilename } from '../../lib/time'
import { Button, ScoreBadge, Toggle } from '../../components/ui/controls'

const SIZE = { '9:16': '1080 × 1920', '1:1': '1080 × 1080', '16:9': '1920 × 1080' } as const

export function ExportDialog() {
  const open = useUi((s) => s.exportOpen)
  const setOpen = useUi((s) => s.setExportOpen)
  const clips = useEditor((s) => s.data.clips)
  const aspect = useEditor((s) => s.aspect)
  const commit = useEditor((s) => s.commit)
  const { folder, includeSrt, items, running, init, chooseFolder, setIncludeSrt, enqueue, clearFinished } = useExport()
  const [showSetup, setShowSetup] = useState(true)
  const desktop = !!window.clipforge

  useEffect(() => {
    if (!open) return
    void init()
    setShowSetup(!items.length)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [open])

  if (!open) return null
  const selected = clips.filter((c) => c.selected)
  const finished = items.filter((i) => i.status === 'done')
  const active = items.filter((i) => i.status === 'queued' || i.status === 'rendering')

  const start = () => {
    enqueue(selected.map((c) => c.id))
    setShowSetup(false)
  }

  return (
    <div className="fixed inset-0 z-40 flex animate-fade-in items-center justify-center bg-black/60 backdrop-blur-sm" onMouseDown={(e) => e.target === e.currentTarget && setOpen(false)}>
      <div className="flex max-h-[88vh] w-[640px] flex-col overflow-hidden rounded-2xl border border-line-strong bg-panel shadow-2xl">
        <div className="flex items-center justify-between border-b border-line px-5 py-4">
          <div>
            <h2 className="text-base font-semibold">Export clips</h2>
            <p className="text-xs text-muted">{SIZE[aspect]} · H.264 + AAC · 30 fps · captions burned in · TikTok-ready</p>
          </div>
          <button onClick={() => setOpen(false)} className="text-muted hover:text-fg" aria-label="Close"><X size={18} /></button>
        </div>

        {!desktop ? (
          <div className="flex flex-col items-center gap-2 px-6 py-12 text-center">
            <AlertCircle size={22} className="text-warn" />
            <div className="text-[13px] font-medium">Export needs the desktop app</div>
            <div className="text-xs text-muted">Run <code>npm run dev</code> to render clips with FFmpeg.</div>
          </div>
        ) : showSetup ? (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {clips.length === 0 && <div className="py-10 text-center text-xs text-faint">Generate clips first.</div>}
              {clips.map((c) => (
                <div key={c.id} className={clsx('flex items-center gap-3 rounded-lg px-3 py-2 transition-colors hover:bg-panel-2', !c.selected && 'opacity-45')}>
                  <button
                    onClick={() => commit((d) => { const x = d.clips.find((y) => y.id === c.id)!; x.selected = !x.selected })}
                    aria-label={c.selected ? 'Exclude' : 'Include'}
                    className={clsx('flex h-[18px] w-[18px] shrink-0 items-center justify-center rounded border', c.selected ? 'border-accent bg-accent text-white' : 'border-line-strong text-transparent')}
                  >
                    <Check size={12} strokeWidth={3} />
                  </button>
                  <ScoreBadge score={c.score} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px]">{c.title}</div>
                    <div className="truncate font-mono text-[11px] text-faint">{safeFilename(c.title)}.mp4{includeSrt && ' + .srt'}</div>
                  </div>
                  <span className="w-10 text-right text-xs tabular-nums text-muted">{formatDuration(c.srcEnd - c.srcStart)}</span>
                </div>
              ))}
            </div>
            <div className="flex flex-col gap-3 border-t border-line px-5 py-4">
              <div className="flex items-center gap-3">
                <FolderOpen size={15} className="shrink-0 text-muted" />
                <span className="min-w-0 flex-1 truncate font-mono text-xs text-muted" title={folder ?? ''}>{folder ?? '…'}</span>
                <Button size="sm" onClick={chooseFolder}>Change…</Button>
              </div>
              <Toggle label="Also save .srt subtitle files" checked={includeSrt} onChange={setIncludeSrt} />
              <div className="flex items-center justify-between">
                <span className="text-xs text-muted">{selected.length} of {clips.length} clips selected</span>
                <div className="flex gap-2">
                  {items.length > 0 && <Button onClick={() => setShowSetup(false)}>View queue</Button>}
                  <Button variant="primary" onClick={start} disabled={!selected.length || !folder}>
                    Export {selected.length} clip{selected.length === 1 ? '' : 's'}
                  </Button>
                </div>
              </div>
            </div>
          </>
        ) : (
          <>
            <div className="min-h-0 flex-1 overflow-y-auto p-3">
              {items.map((i) => <QueueRow key={i.id} item={i} />)}
            </div>
            <div className="flex items-center justify-between gap-2 border-t border-line px-5 py-4">
              <span className="text-xs text-muted">
                {running ? `Rendering · ${active.length} left` : `${finished.length} of ${items.length} done`}
              </span>
              <div className="flex gap-2">
                {folder && <Button size="sm" variant="ghost" onClick={() => window.clipforge?.openFolder(folder)}><FolderOpen size={14} /> Open folder</Button>}
                {items.length > active.length && <Button size="sm" variant="ghost" onClick={clearFinished}>Clear finished</Button>}
                <Button size="sm" onClick={() => setShowSetup(true)}>Export more</Button>
                <Button size="sm" variant="primary" onClick={() => setOpen(false)}>{running ? 'Run in background' : 'Done'}</Button>
              </div>
            </div>
          </>
        )}
      </div>
    </div>
  )
}

function QueueRow({ item }: { item: ExportItem }) {
  const { cancel, retry } = useExport()
  const icon = {
    queued: <span className="h-3.5 w-3.5 rounded-full border-2 border-line-strong" />,
    rendering: <Loader2 size={15} className="animate-spin text-accent" />,
    done: <CheckCircle2 size={15} className="text-good" />,
    error: <AlertCircle size={15} className="text-bad" />,
    cancelled: <Ban size={15} className="text-faint" />,
  }[item.status]
  return (
    <div className="flex items-center gap-3 rounded-lg px-3 py-2.5 hover:bg-panel-2">
      <span className="flex w-4 justify-center">{icon}</span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-[13px]">{item.title}</div>
        <div className={clsx('truncate text-[11px]', item.status === 'error' ? 'text-bad' : 'font-mono text-faint')} title={item.error ?? item.outputPath}>
          {item.status === 'error' ? item.error : item.outputPath ?? item.filename}
        </div>
        {item.status === 'rendering' && (
          <div className="mt-1.5 h-1 overflow-hidden rounded-full bg-raised">
            <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${item.progress * 100}%` }} />
          </div>
        )}
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-muted">
        {item.status === 'rendering' ? `${Math.round(item.progress * 100)}%` : ''}
      </span>
      <div className="flex w-[92px] justify-end">
        {(item.status === 'queued' || item.status === 'rendering') && <Button size="sm" variant="ghost" onClick={() => cancel(item.id)}>Cancel</Button>}
        {(item.status === 'error' || item.status === 'cancelled') && <Button size="sm" variant="ghost" onClick={() => retry(item.id)}><RotateCcw size={13} /> Retry</Button>}
        {item.status === 'done' && item.outputPath && <Button size="sm" variant="ghost" onClick={() => window.clipforge?.showItem(item.outputPath!)}>Show</Button>}
      </div>
    </div>
  )
}
