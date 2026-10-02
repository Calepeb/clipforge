import { useRef, useState } from 'react'
import clsx from 'clsx'
import { AlertTriangle, Film, Loader2, UploadCloud, Wand2 } from 'lucide-react'
import { useEditor } from '../../stores/editorStore'
import { useUi } from '../../stores/uiStore'
import { useFrame } from '../../lib/media'
import { importVideoFiles } from '../../lib/importMedia'
import { formatDuration } from '../../lib/time'
import type { MediaAsset } from '../../types/editor'
import { PanelHeader } from '../left-panel/LeftPanel'

export function MediaTab() {
  const media = useEditor((s) => s.media)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  return (
    <>
      <PanelHeader title="Media" />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); importVideoFiles(e.dataTransfer.files) }}
          onClick={() => input.current?.click()}
          className={clsx(
            'flex cursor-pointer flex-col items-center gap-2 rounded-xl border-2 border-dashed px-4 py-6 text-center transition-colors',
            over ? 'border-accent bg-accent-soft' : 'border-line-strong hover:border-muted hover:bg-panel-2',
          )}
        >
          <UploadCloud size={26} className={over ? 'text-accent' : 'text-muted'} />
          <div className="text-[13px] font-medium">Drop videos here</div>
          <div className="text-xs text-faint">or click to browse · MP4, MOV, WebM</div>
          <input
            ref={input}
            type="file"
            accept="video/*"
            multiple
            hidden
            onChange={(e) => { if (e.target.files) importVideoFiles(e.target.files); e.target.value = '' }}
          />
        </div>
        <div className="grid grid-cols-2 gap-2.5">
          {media.map((m) => (
            <MediaTile key={m.id} asset={m} />
          ))}
        </div>
      </div>
    </>
  )
}

function MediaTile({ asset }: { asset: MediaAsset }) {
  const thumb = useFrame(asset.status === 'ready' ? asset.src : undefined, Math.min(2, asset.duration / 2), 240)
  const setGenSource = useUi((s) => s.setGenSource)
  return (
    <div className="group flex flex-col gap-1.5">
      <div className="relative aspect-video overflow-hidden rounded-lg border border-line bg-app transition-colors group-hover:border-line-strong">
        {asset.status === 'missing' ? (
          <div className="flex h-full w-full flex-col items-center justify-center gap-1 px-2 text-center text-[11px] text-warn" title={asset.path ?? 'This video was imported in the browser and is no longer available.'}>
            <AlertTriangle size={16} />
            File not found
          </div>
        ) : thumb ? (
          <img src={thumb} alt="" className="h-full w-full object-cover" />
        ) : (
          <div className="skeleton h-full w-full" />
        )}
        {asset.status === 'processing' && (
          <div className="absolute inset-0 flex items-center justify-center bg-black/50"><Loader2 size={18} className="animate-spin" /></div>
        )}
        {asset.status === 'ready' && (
          <>
            <span className="absolute bottom-1 right-1 rounded bg-black/70 px-1 text-[10.5px] tabular-nums">{formatDuration(asset.duration)}</span>
            <button
              onClick={() => setGenSource(asset.id)}
              className="absolute inset-0 flex items-center justify-center gap-1.5 bg-black/55 text-xs font-medium opacity-0 transition-opacity group-hover:opacity-100"
            >
              <Wand2 size={14} /> Find clips
            </button>
          </>
        )}
      </div>
      <div className="flex items-center gap-1.5 text-xs text-muted">
        <Film size={12} className="shrink-0" />
        <span className="truncate" title={asset.path ?? asset.name}>{asset.name}</span>
      </div>
    </div>
  )
}
