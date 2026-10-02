import { useEffect, useMemo, useRef } from 'react'
import clsx from 'clsx'
import { Download, Plus } from 'lucide-react'
import { useActiveStyle, useEditor } from '../../stores/editorStore'
import { useUi } from '../../stores/uiStore'
import { CAPTION_PRESETS, type CaptionChunk } from '../../lib/captions'
import { formatTimecode, safeFilename, uid } from '../../lib/time'
import { buildSrt } from '../../lib/renderSpec'
import { saveTextFile } from '../../lib/saveText'
import type { Word } from '../../types/editor'
import { Button } from '../../components/ui/controls'
import { PanelHeader } from '../left-panel/LeftPanel'
import { CaptionRender } from './CaptionRender'
import { useCaptionActions, useCaptionChunks } from './useCaptionActions'

const SAMPLE: Word[] = [
  { id: 's1', text: 'This', start: 0, end: 0.4 },
  { id: 's2', text: 'is', start: 0.4, end: 0.9 },
  { id: 's3', text: 'huge', start: 10, end: 11 },
]

export function CaptionsTab() {
  const style = useActiveStyle()
  const { applyPreset, applyToAll } = useCaptionActions()
  const commit = useEditor((s) => s.commit)
  const select = useEditor((s) => s.select)

  const addText = () => {
    const { activeClipId, time } = useEditor.getState()
    if (!activeClipId) return
    const id = uid('t')
    commit((d) => {
      d.docs[activeClipId].texts.push({
        id, start: time, end: time + 3, text: 'Your text', fontFamily: 'Poppins', fontSize: 64,
        color: '#ffffff', background: null, x: 0.5, y: 0.3, isHook: false,
      })
    })
    select({ kind: 'text', id })
  }

  return (
    <>
      <PanelHeader title="Text & Captions" />
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex max-h-[55%] shrink-0 flex-col gap-3 overflow-y-auto border-b border-line p-3">
          <Button size="sm" onClick={addText}>
            <Plus size={14} /> Add text layer
          </Button>
          <div className="text-xs font-semibold uppercase tracking-wide text-muted">Caption styles</div>
          <div className="grid grid-cols-2 gap-2">
            {CAPTION_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => applyPreset(p.style)}
                className={clsx(
                  'group flex flex-col overflow-hidden rounded-lg border-2 text-left transition-colors',
                  style?.presetId === p.id ? 'border-accent' : 'border-line hover:border-line-strong',
                )}
              >
                <div className="flex h-[74px] items-center justify-center overflow-hidden bg-[radial-gradient(circle_at_30%_20%,#3a3350,#15161b)] px-1">
                  <CaptionRender style={p.style} words={p.style.wordsPerChunk === 1 ? SAMPLE.slice(2) : SAMPLE.slice(0, p.style.wordsPerChunk === 2 ? 2 : 3)} time={0.5} scale={0.24} />
                </div>
                <span className="px-2 py-1.5 text-xs text-muted group-hover:text-fg">{p.name}</span>
              </button>
            ))}
          </div>
          <Button size="sm" onClick={applyToAll}>Apply current style to all clips</Button>
        </div>
        <CaptionList />
      </div>
    </>
  )
}

function CaptionList() {
  const { chunks } = useCaptionChunks()
  const time = useEditor((s) => s.time)
  const seek = useEditor((s) => s.seek)
  const toast = useUi((s) => s.toast)
  const exportSrt = async () => {
    const { activeClipId, data } = useEditor.getState()
    const clip = data.clips.find((c) => c.id === activeClipId)
    if (!clip || !chunks.length) return toast({ kind: 'info', title: 'No captions to export' })
    try {
      const saved = await saveTextFile(`${safeFilename(clip.title)}.srt`, buildSrt(clip.id), 'Subtitles', ['srt'])
      if (saved) toast({ kind: 'success', title: 'Subtitles saved', body: saved })
    } catch (err) {
      toast({ kind: 'error', title: 'Could not save subtitles', body: err instanceof Error ? err.message : String(err) })
    }
  }
  const currentId = useMemo(() => chunks.find((c) => time >= c.start && time < c.end + 0.12)?.id, [chunks, time])
  const listRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!currentId || listRef.current?.contains(document.activeElement)) return
    // Scroll only the transcript list, never the outer panel.
    const list = listRef.current
    const row = list?.querySelector<HTMLElement>(`[data-chunk="${currentId}"]`)
    if (!list || !row) return
    const top = row.offsetTop // list is `relative`, so this is relative to the list
    if (top < list.scrollTop || top + row.offsetHeight > list.scrollTop + list.clientHeight) list.scrollTop = top - list.clientHeight / 3
  }, [currentId])

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between px-4 py-2.5">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted">Transcript · {chunks.length} captions</span>
        <button
          onClick={exportSrt}
          className="flex items-center gap-1 text-xs text-muted hover:text-fg"
          title="Export .srt"
        >
          <Download size={13} /> .srt
        </button>
      </div>
      <div ref={listRef} className="relative flex min-h-0 flex-1 flex-col gap-0.5 overflow-y-auto px-2 pb-3">
        {chunks.map((c) => (
          <CaptionRow key={c.id} chunk={c} current={c.id === currentId} onSeek={() => seek(c.start)} />
        ))}
      </div>
    </div>
  )
}

function CaptionRow({ chunk, current, onSeek }: { chunk: CaptionChunk; current: boolean; onSeek: () => void }) {
  const { editChunk } = useCaptionActions()
  const selected = useEditor((s) => s.selection?.kind === 'caption' && s.selection.id === chunk.id)
  const select = useEditor((s) => s.select)
  return (
    <div
      data-chunk={chunk.id}
      className={clsx(
        'flex items-center gap-2 rounded-md px-2 py-1 transition-colors',
        selected ? 'bg-accent-soft' : current ? 'bg-raised' : 'hover:bg-panel-2',
      )}
    >
      <button onClick={onSeek} className={clsx('w-11 shrink-0 text-left text-[11px] tabular-nums', current ? 'text-accent' : 'text-faint hover:text-fg')}>
        {formatTimecode(chunk.start)}
      </button>
      <input
        key={chunk.text}
        defaultValue={chunk.text}
        onFocus={() => { select({ kind: 'caption', id: chunk.id }); onSeek() }}
        onBlur={(e) => editChunk(chunk, e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter') e.currentTarget.blur()
          if (e.key === 'Escape') { e.currentTarget.value = chunk.text; e.currentTarget.blur() }
        }}
        className="min-w-0 flex-1 rounded bg-transparent px-1.5 py-1 text-[13px] outline-none focus:bg-app focus:ring-1 focus:ring-accent"
      />
    </div>
  )
}
