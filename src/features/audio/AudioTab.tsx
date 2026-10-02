import { useRef, useState } from 'react'
import clsx from 'clsx'
import { AlertTriangle, Loader2, Music2, Plus, UploadCloud } from 'lucide-react'
import { docDuration, useEditor } from '../../stores/editorStore'
import { useUi } from '../../stores/uiStore'
import { importMusicFiles } from '../../lib/importMedia'
import { useWaveform } from '../../lib/media'
import { formatDuration, uid } from '../../lib/time'
import type { MusicAsset } from '../../types/editor'
import { Button } from '../../components/ui/controls'
import { Waveform } from '../timeline/Waveform'
import { PanelHeader } from '../left-panel/LeftPanel'

/** Adds a music track under a clip: full length, quiet, ducking under speech. */
function addToClip(clipId: string, m: MusicAsset) {
  const { data, commit } = useEditor.getState()
  const end = docDuration(data.docs[clipId])
  if (!end) return null
  const id = uid('a')
  commit((d) => {
    const doc = d.docs[clipId]
    doc.audio = [{ id, name: m.name, musicId: m.id, start: 0, end, volume: 0.35, fadeIn: 0.5, fadeOut: 1.5, ducking: true, duckAmount: 0.6, seed: 0 }]
  })
  return id
}

export function AudioTab() {
  const music = useEditor((s) => s.music)
  const clipId = useEditor((s) => s.activeClipId)
  const clipCount = useEditor((s) => s.data.clips.length)
  const select = useEditor((s) => s.select)
  const toast = useUi((s) => s.toast)
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)

  const add = (m: MusicAsset) => {
    if (!clipId) return
    const id = addToClip(clipId, m)
    if (id) select({ kind: 'audio', id })
    toast({ kind: 'success', title: 'Music added', body: 'It ducks under speech automatically.' })
  }
  const addAll = (m: MusicAsset) => {
    const { data } = useEditor.getState()
    data.clips.forEach((c) => addToClip(c.id, m))
    toast({ kind: 'success', title: `Music added to ${data.clips.length} clips` })
  }

  return (
    <>
      <PanelHeader title="Audio" />
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        <div
          onDragOver={(e) => { e.preventDefault(); setOver(true) }}
          onDragLeave={() => setOver(false)}
          onDrop={(e) => { e.preventDefault(); setOver(false); importMusicFiles(e.dataTransfer.files) }}
          onClick={() => input.current?.click()}
          className={clsx(
            'flex cursor-pointer items-center gap-3 rounded-xl border-2 border-dashed px-4 py-4 transition-colors',
            over ? 'border-accent bg-accent-soft' : 'border-line-strong hover:border-muted hover:bg-panel-2',
          )}
        >
          <UploadCloud size={22} className={over ? 'text-accent' : 'text-muted'} />
          <div>
            <div className="text-[13px] font-medium">Import music</div>
            <div className="text-xs text-faint">MP3, M4A, WAV, OGG, FLAC · use tracks you have the rights to</div>
          </div>
          <input ref={input} type="file" accept="audio/*" multiple hidden onChange={(e) => { if (e.target.files) importMusicFiles(e.target.files); e.target.value = '' }} />
        </div>
        {music.length === 0 && <p className="px-1 py-4 text-center text-xs text-faint">No music yet. Imported tracks appear here.</p>}
        {music.map((m) => (
          <MusicRow key={m.id} m={m} onAdd={() => add(m)} onAddAll={clipCount > 1 ? () => addAll(m) : undefined} canAdd={!!clipId} />
        ))}
      </div>
    </>
  )
}

function MusicRow({ m, onAdd, onAddAll, canAdd }: { m: MusicAsset; onAdd: () => void; onAddAll?: () => void; canAdd: boolean }) {
  const peaks = useWaveform(m.status === 'ready' ? m.src : undefined)
  return (
    <div className="group flex flex-col gap-2 rounded-lg border border-line bg-panel-2 p-2.5 transition-colors hover:border-line-strong">
      <div className="flex items-center gap-3">
        <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md bg-gradient-to-br from-track-audio/40 to-track-video/30">
          {m.status === 'processing' ? <Loader2 size={15} className="animate-spin" /> : m.status === 'missing' ? <AlertTriangle size={15} className="text-warn" /> : <Music2 size={15} />}
        </div>
        <div className="min-w-0 flex-1">
          <div className="truncate text-[13px]" title={m.path ?? m.name}>{m.name}</div>
          <div className="text-[11px] text-faint">{m.status === 'missing' ? 'File not found' : formatDuration(m.duration)}</div>
        </div>
        <button
          onClick={onAdd}
          disabled={!canAdd || m.status !== 'ready'}
          aria-label={`Add ${m.name} to this clip`}
          title="Add to this clip"
          className="flex h-7 w-7 items-center justify-center rounded-md bg-raised text-muted transition-colors hover:bg-accent hover:text-white disabled:opacity-30"
        >
          <Plus size={15} />
        </button>
      </div>
      <Waveform peaks={peaks} className="h-5 w-full text-track-audio/60" />
      {onAddAll && m.status === 'ready' && (
        <Button size="sm" variant="ghost" className="self-start" onClick={onAddAll}>Add to all clips</Button>
      )}
    </div>
  )
}
