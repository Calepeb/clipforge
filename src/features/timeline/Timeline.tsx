import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import clsx from 'clsx'
import { Captions, Film, Link2, Magnet, Maximize, Music2, Scissors, Trash2, Type, ZoomIn, ZoomOut } from 'lucide-react'
import { docDuration, mergeablePair, useActiveDoc, useActiveStyle, useEditor } from '../../stores/editorStore'
import { chunkWords, type CaptionChunk } from '../../lib/captions'
import { timelineWords } from '../../lib/timelineWords'
import { clamp, formatTimecode } from '../../lib/time'
import { syntheticPeaks, useFrames, useWaveform } from '../../lib/media'
import type { AudioItem, Selection, TextItem, TrackKind, VideoItem } from '../../types/editor'
import { IconButton } from '../../components/ui/controls'
import { useCaptionActions } from '../captions/useCaptionActions'
import { tickInterval } from './snap'
import { useItemDrag, type DragMode } from './useItemDrag'
import { Waveform } from './Waveform'

const TRACKS: { kind: TrackKind; label: string; icon: typeof Film; height: number; color: string }[] = [
  { kind: 'text', label: 'Text', icon: Type, height: 30, color: 'var(--color-track-text)' },
  { kind: 'caption', label: 'Captions', icon: Captions, height: 34, color: 'var(--color-track-caption)' },
  { kind: 'video', label: 'Video', icon: Film, height: 66, color: 'var(--color-track-video)' },
  { kind: 'audio', label: 'Music', icon: Music2, height: 42, color: 'var(--color-track-audio)' },
]
const RULER_H = 26
const HEADER_W = 112
const TRACK_GAP = 6
const MIN_PPS = 8
const MAX_PPS = 400

/** Log-scale mapping between the zoom slider (0..100) and pixels per second. */
const toPps = (v: number) => MIN_PPS * (MAX_PPS / MIN_PPS) ** (v / 100)
const toSlider = (pps: number) => (Math.log(pps / MIN_PPS) / Math.log(MAX_PPS / MIN_PPS)) * 100

export function Timeline() {
  const doc = useActiveDoc()
  const style = useActiveStyle()
  const pps = useEditor((s) => s.pxPerSec)
  const time = useEditor((s) => s.time)
  const playing = useEditor((s) => s.playing)
  const selection = useEditor((s) => s.selection)
  const snapping = useEditor((s) => s.snapping)
  const { setPxPerSec, toggleSnapping, splitAtPlayhead, deleteSelection, mergeWithNext, seek, select } = useEditor.getState()
  const scrollRef = useRef<HTMLDivElement>(null)
  const [snapLine, setSnapLine] = useState<number | null>(null)
  const startDrag = useItemDrag(setSnapLine)

  const dur = docDuration(doc)
  const [viewW, setViewW] = useState(800)
  const contentW = Math.max(viewW, (dur + 8) * pps)
  const chunks = useMemo(() => (doc && style ? chunkWords(timelineWords(doc), style.wordsPerChunk) : []), [doc, style])

  useEffect(() => {
    const el = scrollRef.current!
    const ro = new ResizeObserver(() => setViewW(el.clientWidth))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Keep the playhead in view while playing.
  useEffect(() => {
    const el = scrollRef.current
    if (!el || !playing) return
    const x = time * pps
    if (x > el.scrollLeft + el.clientWidth - 40 || x < el.scrollLeft) el.scrollLeft = x - el.clientWidth * 0.1
  }, [time, pps, playing])

  // Ctrl/Cmd + wheel zooms around the cursor.
  useEffect(() => {
    const el = scrollRef.current!
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return
      e.preventDefault()
      const st = useEditor.getState()
      const rect = el.getBoundingClientRect()
      const cursorT = (e.clientX - rect.left + el.scrollLeft) / st.pxPerSec
      const next = clamp(st.pxPerSec * (e.deltaY < 0 ? 1.15 : 1 / 1.15), MIN_PPS, MAX_PPS)
      st.setPxPerSec(next)
      requestAnimationFrame(() => { el.scrollLeft = cursorT * next - (e.clientX - rect.left) })
    }
    el.addEventListener('wheel', onWheel, { passive: false })
    return () => el.removeEventListener('wheel', onWheel)
  }, [])

  const scrubFrom = (e: React.PointerEvent) => {
    if (e.button !== 0) return
    const el = scrollRef.current!
    const at = (x: number) => seek((x - el.getBoundingClientRect().left + el.scrollLeft) / useEditor.getState().pxPerSec)
    at(e.clientX)
    const move = (ev: PointerEvent) => at(ev.clientX)
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const isSel = (kind: NonNullable<Selection>['kind'], id: string) =>
    selection?.kind === kind && selection.id === id

  const canMerge = !!doc && selection?.kind === 'video' && !!mergeablePair(doc, selection.id)
  const canSplit = !!doc && [...doc.video, ...doc.texts, ...doc.audio].some((it) => time > it.start + 0.05 && time < it.end - 0.05)

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-panel">
      {/* Toolbar */}
      <div className="flex h-10 shrink-0 items-center gap-1 border-b border-line px-2">
        <IconButton label="Split at playhead (S)" onClick={splitAtPlayhead} disabled={!canSplit}><Scissors size={16} /></IconButton>
        <IconButton label="Delete (Del) · video closes the gap; Shift+Del keeps it" onClick={() => deleteSelection()} disabled={!selection}><Trash2 size={16} /></IconButton>
        <IconButton
          label={canMerge ? 'Merge with next segment (M)' : 'Merge (M): select a video segment followed by its continuation'}
          onClick={() => selection?.kind === 'video' && mergeWithNext(selection.id)}
          disabled={!canMerge}
        >
          <Link2 size={16} />
        </IconButton>
        <div className="mx-1 h-4 w-px bg-line" />
        <IconButton label={`Snapping ${snapping ? 'on' : 'off'}`} active={snapping} onClick={toggleSnapping}><Magnet size={16} /></IconButton>
        <span className="ml-3 font-mono text-xs tabular-nums text-muted">
          {formatTimecode(time, true)} / {formatTimecode(dur, true)}
        </span>
        <div className="flex-1" />
        <IconButton label="Zoom out (-)" onClick={() => setPxPerSec(pps / 1.25)}><ZoomOut size={15} /></IconButton>
        <input
          type="range"
          aria-label="Timeline zoom"
          className="cf-range w-28"
          min={0}
          max={100}
          step={0.5}
          value={toSlider(pps)}
          style={{ ['--fill' as string]: `${toSlider(pps)}%` }}
          onChange={(e) => setPxPerSec(toPps(+e.target.value))}
        />
        <IconButton label="Zoom in (+)" onClick={() => setPxPerSec(pps * 1.25)}><ZoomIn size={15} /></IconButton>
        <IconButton label="Fit to view" onClick={() => dur && setPxPerSec((viewW - 40) / dur)}><Maximize size={15} /></IconButton>
      </div>

      <div className="flex min-h-0 flex-1">
        {/* Track headers */}
        <div className="shrink-0 border-r border-line" style={{ width: HEADER_W }}>
          <div style={{ height: RULER_H }} className="border-b border-line" />
          <div className="flex flex-col pt-1.5" style={{ gap: TRACK_GAP }}>
            {TRACKS.map((t) => (
              <div key={t.kind} className="flex items-center gap-2 px-3 text-xs text-muted" style={{ height: t.height }}>
                <t.icon size={14} style={{ color: t.color }} />
                {t.label}
              </div>
            ))}
          </div>
        </div>

        {/* Scrollable lanes */}
        <div ref={scrollRef} className="relative min-w-0 flex-1 overflow-x-auto overflow-y-hidden">
          <div className="relative h-full" style={{ width: contentW }}>
            <Ruler pps={pps} width={contentW} onPointerDown={scrubFrom} />
            <div
              className="relative flex flex-col pt-1.5"
              style={{ gap: TRACK_GAP }}
              onPointerDown={(e) => { if (e.target === e.currentTarget || (e.target as HTMLElement).dataset.lane) { select(null); scrubFrom(e) } }}
            >
              {doc && (
                <>
                  <Lane height={TRACKS[0].height}>
                    {doc.texts.map((t) => (
                      <Item key={t.id} item={t} pps={pps} color={TRACKS[0].color} selected={isSel('text', t.id)} onDrag={(e, m) => startDrag(e, 'text', t.id, m)}>
                        <TextContent item={t} />
                      </Item>
                    ))}
                  </Lane>
                  <Lane height={TRACKS[1].height}>
                    {chunks.map((c) => (
                      <CaptionBlock key={c.id} chunk={c} pps={pps} selected={isSel('caption', c.id)} onDrag={(e, m) => startDrag(e, 'caption', c.id, m, c.words.map((w) => w.id))} />
                    ))}
                  </Lane>
                  <Lane height={TRACKS[2].height}>
                    {doc.video.map((v) => (
                      <Item key={v.id} item={v} pps={pps} color={TRACKS[2].color} selected={isSel('video', v.id)} onDrag={(e, m) => startDrag(e, 'video', v.id, m)}>
                        <VideoContent item={v} pps={pps} />
                      </Item>
                    ))}
                  </Lane>
                  <Lane height={TRACKS[3].height}>
                    {doc.audio.map((a) => (
                      <Item key={a.id} item={a} pps={pps} color={TRACKS[3].color} selected={isSel('audio', a.id)} onDrag={(e, m) => startDrag(e, 'audio', a.id, m)}>
                        <AudioContent item={a} />
                      </Item>
                    ))}
                  </Lane>
                </>
              )}
            </div>

            {!doc && (
              <div className="pointer-events-none absolute inset-x-0 top-1/2 text-center text-xs text-faint" style={{ maxWidth: viewW }}>
                Your clip's tracks will appear here once clips are generated.
              </div>
            )}
            {snapLine !== null && <div className="pointer-events-none absolute bottom-0 top-0 z-20 w-px bg-warn" style={{ left: snapLine * pps }} />}
            <Playhead x={time * pps} onPointerDown={scrubFrom} />
          </div>
        </div>
      </div>
    </div>
  )
}

function Ruler({ pps, width, onPointerDown }: { pps: number; width: number; onPointerDown: (e: React.PointerEvent) => void }) {
  const major = tickInterval(pps)
  const minor = major / 5
  const ticks: ReactNode[] = []
  for (let t = 0, i = 0; t * pps < width; t = +(++i * minor).toFixed(3)) {
    const isMajor = i % 5 === 0
    ticks.push(
      <div key={i} className="absolute bottom-0" style={{ left: t * pps }}>
        <div className={clsx('w-px', isMajor ? 'h-2.5 bg-line-strong' : 'h-1.5 bg-line')} />
        {isMajor && <span className="absolute bottom-3 left-1 text-[10px] tabular-nums text-faint">{formatTimecode(t)}</span>}
      </div>,
    )
  }
  return (
    <div onPointerDown={onPointerDown} className="relative cursor-pointer border-b border-line" style={{ height: RULER_H }}>
      {ticks}
    </div>
  )
}

function Playhead({ x, onPointerDown }: { x: number; onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div className="pointer-events-none absolute bottom-0 top-0 z-30" style={{ left: x }}>
      <div onPointerDown={onPointerDown} className="pointer-events-auto absolute -left-[6px] top-1 h-4 w-3 cursor-ew-resize rounded-b-[4px] rounded-t-sm bg-fg [clip-path:polygon(0_0,100%_0,100%_60%,50%_100%,0_60%)]" />
      <div className="absolute bottom-0 top-4 w-px -translate-x-1/2 bg-fg shadow-[0_0_6px_rgb(0_0_0/0.6)]" />
    </div>
  )
}

function Lane({ height, children }: { height: number; children: ReactNode }) {
  return (
    <div data-lane="1" className="relative bg-white/[0.015]" style={{ height }}>
      {children}
    </div>
  )
}

function Item({
  item,
  pps,
  color,
  selected,
  onDrag,
  children,
}: {
  item: { start: number; end: number }
  pps: number
  color: string
  selected: boolean
  onDrag: (e: React.PointerEvent, mode: DragMode) => void
  children: ReactNode
}) {
  return (
    <div
      onPointerDown={(e) => onDrag(e, 'move')}
      className={clsx('group absolute inset-y-0 cursor-grab overflow-hidden rounded-md border transition-[border-color,box-shadow] active:cursor-grabbing', selected ? 'z-10 border-white shadow-[0_0_0_1px_white]' : 'border-black/30 hover:border-white/40')}
      style={{ left: item.start * pps, width: Math.max(4, (item.end - item.start) * pps), background: `color-mix(in srgb, ${color} 28%, #16171c)` }}
    >
      {children}
      <TrimHandle side="l" onPointerDown={(e) => onDrag(e, 'trim-l')} visible={selected} />
      <TrimHandle side="r" onPointerDown={(e) => onDrag(e, 'trim-r')} visible={selected} />
    </div>
  )
}

function TrimHandle({ side, visible, onPointerDown }: { side: 'l' | 'r'; visible: boolean; onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div
      onPointerDown={onPointerDown}
      className={clsx(
        'absolute inset-y-0 z-10 flex w-2 cursor-ew-resize items-center justify-center bg-white transition-opacity',
        side === 'l' ? 'left-0 rounded-l' : 'right-0 rounded-r',
        visible ? 'opacity-100' : 'opacity-0 group-hover:opacity-60',
      )}
    >
      <div className="h-3 w-px bg-black/50" />
    </div>
  )
}

function TextContent({ item }: { item: TextItem }) {
  return (
    <div className="flex h-full items-center gap-1.5 truncate px-2.5 text-[11px] font-medium text-white/90">
      <Type size={11} className="shrink-0" />
      {item.isHook && <span className="rounded bg-track-text/70 px-1 text-[9px] font-bold text-black">HOOK</span>}
      <span className="truncate">{item.text}</span>
    </div>
  )
}

function VideoContent({ item, pps }: { item: VideoItem; pps: number }) {
  const src = useEditor((s) => s.media.find((m) => m.id === item.mediaId)?.src)
  const peaks = useWaveform(src)
  const thumbW = 72
  const width = (item.end - item.start) * pps
  const count = Math.min(60, Math.ceil(width / thumbW))
  // Round to 0.5s so zooming reuses cached frames.
  const times = Array.from({ length: count }, (_, i) => Math.round((item.srcStart + (i * thumbW) / pps) * 2) / 2)
  const frames = useFrames(src, times, 128)
  return (
    <div className="pointer-events-none flex h-full flex-col">
      <div className="flex h-[44px] overflow-hidden">
        {times.map((_, i) => (
          <div key={i} className="h-full shrink-0 border-r border-black/40 bg-black/40" style={{ width: thumbW }}>
            {frames[i] && <img src={frames[i]} alt="" className="h-full w-full object-cover" draggable={false} />}
          </div>
        ))}
      </div>
      <Waveform peaks={peaks} from={item.srcStart} to={item.srcStart + item.end - item.start} className="h-full min-h-0 w-full flex-1 text-track-video/80" />
    </div>
  )
}

function AudioContent({ item }: { item: AudioItem }) {
  const music = useEditor((s) => s.music.find((m) => m.id === item.musicId))
  const real = useWaveform(music?.status === 'ready' ? music.src : undefined)
  // Items from older projects have no music file: show a flat placeholder.
  const placeholder = useMemo(() => syntheticPeaks(item.seed, item.end - item.start).map(() => 0.08), [item.seed, item.end, item.start])
  return (
    <div className="pointer-events-none relative flex h-full flex-col">
      <span className="absolute left-2 top-0.5 z-10 truncate text-[10.5px] font-medium text-white/90">
        {item.name}
        {!music && <span className="ml-1.5 text-[9.5px] text-white/60">· no audio file</span>}
        {music && item.ducking && <span className="ml-1.5 text-[9.5px] text-white/60">· ducking</span>}
      </span>
      <Waveform peaks={real ?? placeholder} to={item.end - item.start} className="mt-3.5 h-full min-h-0 w-full flex-1 text-track-audio/80" />
    </div>
  )
}

function CaptionBlock({ chunk, pps, selected, onDrag }: { chunk: CaptionChunk; pps: number; selected: boolean; onDrag: (e: React.PointerEvent, m: DragMode) => void }) {
  const [editing, setEditing] = useState(false)
  const { editChunk } = useCaptionActions()
  const width = Math.max(4, (chunk.end - chunk.start) * pps)
  return (
    <div
      onPointerDown={(e) => !editing && onDrag(e, 'move')}
      onDoubleClick={() => setEditing(true)}
      title={`${chunk.text}\nDouble-click to edit`}
      className={clsx(
        'group absolute inset-y-0 cursor-grab overflow-hidden rounded-md border text-[11px] transition-[border-color]',
        selected ? 'z-10 border-white shadow-[0_0_0_1px_white]' : 'border-black/30 hover:border-white/40',
        editing && 'z-20 overflow-visible',
      )}
      style={{ left: chunk.start * pps, width, background: 'color-mix(in srgb, var(--color-track-caption) 32%, #16171c)' }}
    >
      {editing ? (
        <input
          autoFocus
          defaultValue={chunk.text}
          onPointerDown={(e) => e.stopPropagation()}
          onBlur={(e) => { editChunk(chunk, e.target.value); setEditing(false) }}
          onKeyDown={(e) => {
            if (e.key === 'Enter') e.currentTarget.blur()
            if (e.key === 'Escape') { e.currentTarget.value = chunk.text; e.currentTarget.blur() }
          }}
          className="absolute inset-y-0 left-0 min-w-[180px] rounded-md bg-app px-2 text-[12px] text-fg outline-none ring-2 ring-accent"
          style={{ width: Math.max(width, 180) }}
        />
      ) : (
        <span className="pointer-events-none flex h-full items-center truncate px-1.5 text-white/90">{chunk.text}</span>
      )}
      {!editing && (
        <>
          <TrimHandle side="l" onPointerDown={(e) => onDrag(e, 'trim-l')} visible={selected} />
          <TrimHandle side="r" onPointerDown={(e) => onDrag(e, 'trim-r')} visible={selected} />
        </>
      )}
    </div>
  )
}

