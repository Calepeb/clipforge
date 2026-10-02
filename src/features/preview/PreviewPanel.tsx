import { useLayoutEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Clapperboard, Maximize2, Pause, Play, SkipBack, SkipForward, UploadCloud, Wand2 } from 'lucide-react'
import { RenderCheckDialog } from './RenderCheckDialog'
import { colorTransform, effectsOf, fadeAt } from '../../lib/effects'
import { useBrand } from '../../stores/brandStore'
import { docDuration, useActiveDoc, useActiveStyle, useEditor } from '../../stores/editorStore'
import { chunkAt, chunkWords } from '../../lib/captions'
import { timelineWords } from '../../lib/timelineWords'
import { clamp, formatTimecode } from '../../lib/time'
import type { AspectRatio, TextItem } from '../../types/editor'
import { Button, IconButton } from '../../components/ui/controls'
import { useUi } from '../../stores/uiStore'
import { CaptionRender } from '../captions/CaptionRender'
import { useCaptionActions } from '../captions/useCaptionActions'
import { usePlayback } from './usePlayback'

const RATIO: Record<AspectRatio, number> = { '9:16': 9 / 16, '1:1': 1, '16:9': 16 / 9 }
/** Output width the caption/text sizes are authored against (1080x1920 export). */
const REF_WIDTH = 1080

export function PreviewPanel() {
  const aspect = useEditor((s) => s.aspect)
  const stageRef = useRef<HTMLDivElement>(null)
  const frameRef = useRef<HTMLDivElement>(null)
  const videoRef = useRef<HTMLVideoElement>(null)
  const canvasRef = useRef<HTMLCanvasElement>(null)
  const [stage, setStage] = useState({ w: 0, h: 0 })

  usePlayback(videoRef, canvasRef)
  const activeDoc = useActiveDoc()
  const hasDoc = !!activeDoc
  const hasColor = !!(activeDoc && colorTransform(effectsOf(activeDoc).color))
  const [renderCheck, setRenderCheck] = useState(false)

  useLayoutEffect(() => {
    const el = stageRef.current!
    const ro = new ResizeObserver(() => setStage({ w: el.clientWidth, h: el.clientHeight }))
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  const ratio = RATIO[aspect]
  const pad = 24
  const frameH = Math.max(0, Math.min(stage.h - pad * 2, (stage.w - pad * 2) / ratio))
  const frameW = frameH * ratio
  const phone = aspect === '9:16'

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-panel">
      <div ref={stageRef} className="relative flex min-h-0 flex-1 items-center justify-center bg-[radial-gradient(ellipse_at_center,#1b1c22_0%,#121317_70%)] fullscreen:bg-black">
        <div
          ref={frameRef}
          className={clsx('relative overflow-hidden bg-black', phone ? 'rounded-[22px] shadow-[0_0_0_6px_#24262e,0_0_0_7px_#3a3d48,0_24px_60px_-10px_rgb(0_0_0/0.7)]' : 'rounded-md shadow-2xl')}
          style={{ width: frameW, height: frameH }}
          onPointerDown={(e) => e.target === e.currentTarget && useEditor.getState().select(null)}
        >
          <ColorFilter />
          <canvas
            ref={canvasRef}
            className="absolute inset-0 h-full w-full origin-center"
            style={{ filter: hasColor ? 'url(#cf-color)' : undefined }}
            onPointerDown={() => useEditor.getState().select(null)}
          />
          {frameW > 0 && <Overlays frameRef={frameRef} width={frameW} />}
          {phone && <div className="pointer-events-none absolute left-1/2 top-2 h-[5px] w-14 -translate-x-1/2 rounded-full bg-black/60" />}
        </div>
        {!hasDoc && <EmptyPreview />}
        <video ref={videoRef} className="pointer-events-none absolute h-px w-px opacity-0" playsInline preload="auto" crossOrigin="anonymous" />
      </div>
      <Transport onFullscreen={() => stageRef.current?.requestFullscreen()} onRenderCheck={() => setRenderCheck(true)} canRender={hasDoc && !!window.clipforge} />
      {renderCheck && <RenderCheckDialog onClose={() => setRenderCheck(false)} />}
    </div>
  )
}

function EmptyPreview() {
  const hasMedia = useEditor((s) => s.media.length > 0)
  const setTab = useUi((s) => s.setLeftTab)
  return (
    <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-panel/90 text-center">
      <div className="flex h-14 w-14 items-center justify-center rounded-2xl bg-raised text-accent">
        {hasMedia ? <Wand2 size={24} /> : <UploadCloud size={24} />}
      </div>
      <div className="text-[15px] font-semibold">{hasMedia ? 'Generate your clips' : 'Add a video to get started'}</div>
      <div className="max-w-xs text-xs leading-relaxed text-muted">
        {hasMedia ? 'Open AI Clips and let ClipForge find the most viral moments.' : 'Import an MP4 in Media. ClipForge will turn it into short vertical clips with captions.'}
      </div>
      <Button variant="primary" size="sm" onClick={() => setTab(hasMedia ? 'clips' : 'media')}>
        {hasMedia ? 'Open AI Clips' : 'Import video'}
      </Button>
    </div>
  )
}

function Overlays({ frameRef, width }: { frameRef: React.RefObject<HTMLDivElement | null>; width: number }) {
  const doc = useActiveDoc()
  const style = useActiveStyle()
  const time = useEditor((s) => s.time)
  const clipId = useEditor((s) => s.activeClipId)
  const selection = useEditor((s) => s.selection)
  const select = useEditor((s) => s.select)
  const commit = useEditor((s) => s.commit)
  const { updateStyle } = useCaptionActions()
  const [guide, setGuide] = useState(false)
  const scale = width / REF_WIDTH

  const chunks = useMemo(() => (doc && style ? chunkWords(timelineWords(doc), style.wordsPerChunk) : []), [doc, style])
  if (!doc || !style || !clipId) return null
  const chunk = chunkAt(chunks, time)
  const dur = docDuration(doc)

  /** Drag inside the frame; reports normalized (0..1) position, snapping x to center. */
  const startDrag = (e: React.PointerEvent, x0: number, y0: number, apply: (x: number, y: number, key: string) => void) => {
    e.stopPropagation()
    const rect = frameRef.current!.getBoundingClientRect()
    const sx = e.clientX
    const sy = e.clientY
    const key = `drag-${performance.now()}`
    const move = (ev: PointerEvent) => {
      let x = clamp(x0 + (ev.clientX - sx) / rect.width, 0.05, 0.95)
      const y = clamp(y0 + (ev.clientY - sy) / rect.height, 0.05, 0.95)
      const snap = Math.abs(x - 0.5) < 0.025
      if (snap) x = 0.5
      setGuide(snap)
      apply(x, y, key)
    }
    const up = () => {
      setGuide(false)
      window.removeEventListener('pointermove', move)
      window.removeEventListener('pointerup', up)
    }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  return (
    <>
      {guide && <div className="pointer-events-none absolute inset-y-0 left-1/2 w-px bg-accent/80" />}

      <EffectOverlays />
      {doc.texts
        .filter((t) => time >= t.start && time < t.end)
        .map((t) => (
          <TextLayer
            key={t.id}
            item={t}
            scale={scale}
            selected={selection?.kind === 'text' && selection.id === t.id}
            onPointerDown={(e) => {
              select({ kind: 'text', id: t.id })
              startDrag(e, t.x, t.y, (x, y, key) =>
                commit((d) => { const it = d.docs[clipId].texts.find((i) => i.id === t.id); if (it) { it.x = x; it.y = y } }, key),
              )
            }}
          />
        ))}

      {chunk && (
        <div
          className={clsx(
            'absolute cursor-move rounded-md px-2 py-1 outline-offset-2 transition-[outline-color]',
            selection?.kind === 'caption' ? 'outline outline-2 outline-accent' : 'outline outline-1 outline-transparent hover:outline-white/40',
          )}
          style={{ left: `${style.x * 100}%`, top: `${style.y * 100}%`, transform: 'translate(-50%, -50%)', maxWidth: width * 0.9 }}
          onPointerDown={(e) => {
            select({ kind: 'caption', id: chunk.id })
            startDrag(e, style.x, style.y, (x, y, key) => updateStyle({ x, y }, key))
          }}
        >
          <CaptionRender style={style} words={chunk.words} time={time} scale={scale} chunkKey={chunk.id} />
        </div>
      )}

      <WatermarkOverlay width={width} />
      <FadeOverlay time={time} duration={dur} />
      {doc.progressBar && dur > 0 && (
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-[3px] bg-white/20">
          <div className="h-full bg-white" style={{ width: `${(time / dur) * 100}%` }} />
        </div>
      )}
    </>
  )
}

/** SVG colour matrix used as the canvas filter — the same affine map the renderer applies. */
function ColorFilter() {
  const doc = useActiveDoc()
  const ct = doc ? colorTransform(effectsOf(doc).color) : null
  if (!ct) return null
  const [m, o] = [ct.matrix, ct.offset]
  const values = [m[0], m[1], m[2], 0, o[0], m[3], m[4], m[5], 0, o[1], m[6], m[7], m[8], 0, o[2], 0, 0, 0, 1, 0].join(' ')
  return (
    <svg width="0" height="0" className="absolute" aria-hidden>
      <filter id="cf-color" colorInterpolationFilters="sRGB">
        <feColorMatrix type="matrix" values={values} />
      </filter>
    </svg>
  )
}

/** Vignette under the captions (same gradient the renderer bakes into its overlay). */
function EffectOverlays() {
  const doc = useActiveDoc()
  const v = doc ? effectsOf(doc).vignette : 0
  if (v <= 0.01) return null
  return <div className="pointer-events-none absolute inset-0" style={{ background: `radial-gradient(ellipse at center, transparent 40%, rgba(0,0,0,${v}) 100%)` }} />
}

/** Fade from/to black over everything, like the renderer's final fade. */
function FadeOverlay({ time, duration }: { time: number; duration: number }) {
  const doc = useActiveDoc()
  const o = doc ? fadeAt(effectsOf(doc), time, duration) : 0
  if (o <= 0) return null
  return <div className="pointer-events-none absolute inset-0 bg-black" style={{ opacity: o }} />
}

/** Brand-kit watermark, positioned like the renderer (4% margin, width = size × frame). */
function WatermarkOverlay({ width }: { width: number }) {
  const wm = useBrand((s) => s.kit.watermark)
  const src = useBrand((s) => s.watermarkSrc)
  if (!wm?.enabled || !src) return null
  const margin = width * 0.04
  return (
    <img
      src={src}
      alt=""
      className="pointer-events-none absolute"
      style={{
        width: width * wm.size,
        opacity: wm.opacity,
        [wm.corner.startsWith('t') ? 'top' : 'bottom']: margin,
        [wm.corner.endsWith('l') ? 'left' : 'right']: margin,
      }}
    />
  )
}

function TextLayer({ item, scale, selected, onPointerDown }: { item: TextItem; scale: number; selected: boolean; onPointerDown: (e: React.PointerEvent) => void }) {
  return (
    <div
      onPointerDown={onPointerDown}
      className={clsx('absolute cursor-move whitespace-pre-wrap rounded-md text-center outline-offset-2', selected ? 'outline outline-2 outline-accent' : 'hover:outline hover:outline-1 hover:outline-white/40')}
      style={{
        left: `${item.x * 100}%`,
        top: `${item.y * 100}%`,
        transform: 'translate(-50%, -50%)',
        maxWidth: '88%',
        fontFamily: `'${item.fontFamily}', sans-serif`,
        fontWeight: 800,
        fontSize: item.fontSize * scale,
        lineHeight: 1.15,
        color: item.color,
        background: item.background ?? undefined,
        padding: item.background ? `${12 * scale}px ${24 * scale}px` : undefined,
        borderRadius: 16 * scale,
        textShadow: item.background ? undefined : `0 ${3 * scale}px ${10 * scale}px rgb(0 0 0 / 0.6)`,
        animation: item.isHook ? 'cap-pop 320ms cubic-bezier(0.2, 0.9, 0.3, 1.3)' : undefined,
      }}
    >
      {item.text}
    </div>
  )
}

function Transport({ onFullscreen, onRenderCheck, canRender }: { onFullscreen: () => void; onRenderCheck: () => void; canRender: boolean }) {
  const time = useEditor((s) => s.time)
  const playing = useEditor((s) => s.playing)
  const setPlaying = useEditor((s) => s.setPlaying)
  const seek = useEditor((s) => s.seek)
  const doc = useActiveDoc()
  const dur = docDuration(doc)
  const barRef = useRef<HTMLDivElement>(null)

  const scrub = (e: React.PointerEvent) => {
    const rect = barRef.current!.getBoundingClientRect()
    const at = (x: number) => seek(clamp((x - rect.left) / rect.width, 0, 1) * dur)
    at(e.clientX)
    const move = (ev: PointerEvent) => at(ev.clientX)
    const up = () => { window.removeEventListener('pointermove', move); window.removeEventListener('pointerup', up) }
    window.addEventListener('pointermove', move)
    window.addEventListener('pointerup', up)
  }

  const togglePlay = () => {
    if (!playing && time >= dur - 0.05) seek(0)
    setPlaying(!playing)
  }

  return (
    <div className="flex shrink-0 flex-col gap-1.5 border-t border-line px-4 pb-2.5 pt-2">
      <div ref={barRef} onPointerDown={scrub} className="group relative h-3 cursor-pointer py-1">
        <div className="h-1 rounded-full bg-raised">
          <div className="h-full rounded-full bg-accent" style={{ width: `${dur ? (time / dur) * 100 : 0}%` }} />
        </div>
        <div className="absolute top-0 h-3 w-3 -translate-x-1/2 rounded-full bg-white opacity-0 shadow transition-opacity group-hover:opacity-100" style={{ left: `${dur ? (time / dur) * 100 : 0}%` }} />
      </div>
      <div className="flex items-center gap-2">
        <span className="w-28 font-mono text-xs tabular-nums text-fg">
          {formatTimecode(time, true)} <span className="text-faint">/ {formatTimecode(dur)}</span>
        </span>
        <div className="flex flex-1 items-center justify-center gap-1">
          <IconButton label="Back 5s" onClick={() => seek(time - 5)}><SkipBack size={15} /></IconButton>
          <button
            onClick={togglePlay}
            aria-label={playing ? 'Pause (Space)' : 'Play (Space)'}
            title={playing ? 'Pause (Space)' : 'Play (Space)'}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-fg text-app transition-transform hover:scale-105 active:scale-95"
          >
            {playing ? <Pause size={16} fill="currentColor" /> : <Play size={16} fill="currentColor" className="ml-0.5" />}
          </button>
          <IconButton label="Forward 5s" onClick={() => seek(time + 5)}><SkipForward size={15} /></IconButton>
        </div>
        <div className="flex w-28 justify-end gap-0.5">
          <IconButton label={canRender ? 'Render check: real FFmpeg output with burned-in captions' : 'Render check needs the desktop app and a clip'} onClick={onRenderCheck} disabled={!canRender}>
            <Clapperboard size={15} />
          </IconButton>
          <IconButton label="Fullscreen" onClick={onFullscreen}><Maximize2 size={15} /></IconButton>
        </div>
      </div>
    </div>
  )
}
