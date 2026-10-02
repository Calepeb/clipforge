import type { Draft } from 'immer'
import { useState, type ReactNode } from 'react'
import { AudioLines, Captions, Film, Loader2, MousePointerClick, ScanFace, Type } from 'lucide-react'
import { autoReframe } from '../../lib/reframe'
import { useBrand } from '../../stores/brandStore'
import { TightenToggle } from '../effects/TightenToggle'
import { useActiveClip, useActiveDoc, useActiveStyle, useEditor } from '../../stores/editorStore'
import { CAPTION_FONTS, CAPTION_PRESETS } from '../../lib/captions'
import { timelineWords } from '../../lib/timelineWords'
import type { AiClip, AudioItem, CaptionAnimation, ClipSignals, ReframeMode, TextItem, TimelineDoc, VideoItem } from '../../types/editor'
import { Button, ColorField, ScoreBadge, Section, Segmented, Select, Slider, Toggle } from '../../components/ui/controls'
import { useCaptionActions } from '../captions/useCaptionActions'

const pct = (v: number) => `${Math.round(v * 100)}%`
const baseFontOptions = CAPTION_FONTS.map((f) => ({ value: f, label: f }))
/** Bundled fonts plus the brand kit's custom font, if any. */
function useFontOptions() {
  const brandFont = useBrand((s) => s.kit.font)
  return brandFont?.path ? [...baseFontOptions, { value: brandFont.family, label: `${brandFont.family} (brand)` }] : baseFontOptions
}

/** Commit a change to the active clip's doc; `key` makes slider drags a single undo step. */
function useDocCommit() {
  const commit = useEditor((s) => s.commit)
  return (fn: (doc: Draft<TimelineDoc>) => void, key?: string) => {
    const id = useEditor.getState().activeClipId
    if (id) commit((d) => fn(d.docs[id]), key)
  }
}

export function PropertiesPanel() {
  const selection = useEditor((s) => s.selection)
  const doc = useActiveDoc()

  let title = 'Clip'
  let icon = <Film size={15} />
  let body: ReactNode = <ClipProps />
  if (selection && doc) {
    if (selection.kind === 'caption') { title = 'Captions'; icon = <Captions size={15} />; body = <CaptionProps /> }
    if (selection.kind === 'text') {
      const item = doc.texts.find((t) => t.id === selection.id)
      if (item) { title = item.isHook ? 'Hook text' : 'Text'; icon = <Type size={15} />; body = <TextProps item={item} /> }
    }
    if (selection.kind === 'audio') {
      const item = doc.audio.find((a) => a.id === selection.id)
      if (item) { title = 'Music'; icon = <AudioLines size={15} />; body = <AudioProps item={item} /> }
    }
    if (selection.kind === 'video') {
      const item = doc.video.find((v) => v.id === selection.id)
      if (item) { title = 'Video segment'; body = <><VideoProps item={item} /><FramingProps /></> }
    }
  }

  return (
    <div className="flex h-full min-h-0 flex-col overflow-hidden rounded-xl border border-line bg-panel">
      <div className="flex h-11 shrink-0 items-center gap-2 border-b border-line px-4 text-[13px] font-semibold">
        <span className="text-accent">{icon}</span>
        {title}
      </div>
      <div key={selection ? `${selection.kind}-${selection.id}` : 'clip'} className="min-h-0 flex-1 animate-fade-in overflow-y-auto">
        {doc ? body : <Empty />}
      </div>
    </div>
  )
}

function Empty() {
  return (
    <div className="flex h-full flex-col items-center justify-center gap-2 p-6 text-center text-xs text-faint">
      <MousePointerClick size={22} />
      Open a clip from AI Clips to edit its properties.
    </div>
  )
}

function ClipProps() {
  const clip = useActiveClip()
  const doc = useActiveDoc()!
  const commit = useEditor((s) => s.commit)
  const select = useEditor((s) => s.select)
  const docCommit = useDocCommit()
  if (!clip) return null
  const setClip = (fn: (c: Draft<AiClip>) => void, key?: string) =>
    commit((d) => { const c = d.clips.find((x) => x.id === clip.id); if (c) fn(c) }, key)

  return (
    <>
      <Section title="Clip info">
        <div className="flex items-start gap-2.5 rounded-lg bg-panel-2 p-2.5">
          <ScoreBadge score={clip.score} className="mt-0.5" />
          <p className="text-xs leading-relaxed text-muted">{clip.reason}</p>
        </div>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">Title (used as filename)</span>
          <input
            value={clip.title}
            onChange={(e) => setClip((c) => { c.title = e.target.value }, `title-${clip.id}`)}
            className="h-8 rounded-lg border border-line bg-raised px-2.5 text-[13px] outline-none focus:border-accent"
          />
        </label>
        <label className="flex flex-col gap-1.5">
          <span className="text-xs text-muted">Hashtags</span>
          <input
            value={clip.hashtags.join(' ')}
            onChange={(e) => setClip((c) => { c.hashtags = e.target.value.split(/\s+/).filter(Boolean) }, `tags-${clip.id}`)}
            className="h-8 rounded-lg border border-line bg-raised px-2.5 text-[13px] text-track-video outline-none focus:border-accent"
          />
        </label>
        <Toggle label="Include in export" checked={clip.selected} onChange={(v) => setClip((c) => { c.selected = v })} />
      </Section>
      {clip.signals && <ScoreBreakdown signals={clip.signals} />}
      <FramingProps />
      <Section title="Cleanup">
        <TightenToggle />
      </Section>
      <Section title="Overlays">
        <Toggle label="Progress bar" checked={doc.progressBar} onChange={(v) => docCommit((d) => { d.progressBar = v })} />
        {doc.texts.some((t) => t.isHook) && (
          <Button size="sm" onClick={() => select({ kind: 'text', id: doc.texts.find((t) => t.isHook)!.id })}>Edit hook text</Button>
        )}
        <Button size="sm" onClick={() => { const w = timelineWords(doc)[0]; if (w) select({ kind: 'caption', id: w.id }) }}>Edit caption style</Button>
      </Section>
    </>
  )
}

const REFRAME: { value: ReframeMode; label: string; title: string }[] = [
  { value: 'track', label: 'Track', title: 'Follow the active speaker (auto-reframe) or set the focus manually' },
  { value: 'center', label: 'Center', title: 'Static center crop' },
  { value: 'blur', label: 'Blur', title: 'Fit with blurred background' },
  { value: 'split', label: 'Split', title: 'Two speakers stacked' },
]

function FramingProps() {
  const doc = useActiveDoc()!
  const clipId = useEditor((s) => s.activeClipId)
  const docCommit = useDocCommit()
  const [running, setRunning] = useState(false)
  const f = doc.framing
  const following = f.mode === 'track' && !!f.keyframes?.length

  const runAuto = async () => {
    if (!clipId) return
    setRunning(true)
    await autoReframe([clipId])
    setRunning(false)
  }

  return (
    <Section title="Framing">
      <Segmented value={f.mode} options={REFRAME} onChange={(mode) => docCommit((d) => { d.framing.mode = mode })} />
      <Button size="sm" onClick={runAuto} disabled={running || !window.clipforge}>
        {running ? <Loader2 size={14} className="animate-spin" /> : <ScanFace size={14} />}
        {running ? 'Tracking faces…' : f.auto ? 'Re-run auto-reframe' : 'Auto-reframe'}
      </Button>
      {f.auto && <p className="-mt-2 text-[11px] leading-snug text-muted">{f.auto.reason}</p>}
      {f.mode === 'track' && following && (
        <div className="flex items-center justify-between gap-2 rounded-lg bg-panel-2 px-2.5 py-2 text-xs">
          <span className="flex items-center gap-1.5 text-good"><ScanFace size={13} /> Following speaker</span>
          <button onClick={() => docCommit((d) => { d.framing.keyframes = [] })} className="text-muted hover:text-fg">
            Use manual focus
          </button>
        </div>
      )}
      {f.mode === 'track' && !following && (
        <Slider label="Focus position" value={f.focusX} min={0} max={1} step={0.01} format={pct} onChange={(v) => docCommit((d) => { d.framing.focusX = v }, 'focus')} />
      )}
      <Slider label="Zoom" value={f.zoom} min={1} max={2} step={0.01} format={(v) => `${v.toFixed(2)}×`} onChange={(v) => docCommit((d) => { d.framing.zoom = v }, 'zoom')} />
    </Section>
  )
}

function VideoProps({ item }: { item: VideoItem }) {
  const docCommit = useDocCommit()
  const set = (fn: (v: Draft<VideoItem>) => void, key?: string) => docCommit((d) => { const v = d.video.find((x) => x.id === item.id); if (v) fn(v) }, key)
  return (
    <Section title="Segment">
      <div className="grid grid-cols-2 gap-2 text-xs">
        <Stat label="Source in" value={`${item.srcStart.toFixed(2)}s`} />
        <Stat label="Length" value={`${(item.end - item.start).toFixed(2)}s`} />
      </div>
      <Slider label="Volume" value={item.volume} min={0} max={2} step={0.01} format={pct} onChange={(v) => set((x) => { x.volume = v }, `vol-${item.id}`)} />
    </Section>
  )
}

function CaptionProps() {
  const fontOptions = useFontOptions()
  const style = useActiveStyle()!
  const { updateStyle, applyPreset, applyToAll } = useCaptionActions()
  return (
    <>
      <Section title="Preset">
        <Select
          label="Style preset"
          value={style.presetId}
          options={CAPTION_PRESETS.map((p) => ({ value: p.id, label: p.name }))}
          onChange={(id) => applyPreset(CAPTION_PRESETS.find((p) => p.id === id)!.style)}
        />
        <Button size="sm" onClick={applyToAll}>Apply to all clips</Button>
      </Section>
      <Section title="Text">
        <Select label="Font" value={style.fontFamily} options={fontOptions} onChange={(fontFamily) => updateStyle({ fontFamily })} fontPreview />
        <Slider label="Size" value={style.fontSize} min={32} max={140} unit="px" onChange={(fontSize) => updateStyle({ fontSize })} />
        <Segmented
          label="Weight"
          value={style.fontWeight}
          options={[{ value: 600, label: 'Semi' }, { value: 700, label: 'Bold' }, { value: 800, label: 'Heavy' }, { value: 900, label: 'Black' }]}
          onChange={(fontWeight) => updateStyle({ fontWeight })}
        />
        <Toggle label="UPPERCASE" checked={style.uppercase} onChange={(uppercase) => updateStyle({ uppercase })} />
        <ColorField label="Text color" value={style.textColor} onChange={(textColor) => updateStyle({ textColor })} />
      </Section>
      <Section title="Highlight">
        <Segmented
          label="Word highlight"
          value={style.highlightMode}
          options={[{ value: 'word', label: 'Active word' }, { value: 'none', label: 'Off' }]}
          onChange={(highlightMode) => updateStyle({ highlightMode })}
        />
        {style.highlightMode === 'word' && <ColorField label="Highlight color" value={style.highlightColor} onChange={(highlightColor) => updateStyle({ highlightColor })} />}
        <Toggle label="Keyword emphasis" checked={style.keywordEmphasis} onChange={(keywordEmphasis) => updateStyle({ keywordEmphasis })} hint="Colors attention-grabbing words" />
        {style.keywordEmphasis && <ColorField label="Keyword color" value={style.keywordColor} onChange={(keywordColor) => updateStyle({ keywordColor })} />}
        <Toggle label="Auto emojis" checked={style.emojis} onChange={(emojis) => updateStyle({ emojis })} />
      </Section>
      <Section title="Outline & shadow">
        <Slider label="Outline" value={style.outlineWidth} min={0} max={16} unit="px" onChange={(outlineWidth) => updateStyle({ outlineWidth })} />
        <ColorField label="Outline color" value={style.outlineColor} onChange={(outlineColor) => updateStyle({ outlineColor })} />
        <Toggle label="Drop shadow" checked={style.shadow} onChange={(shadow) => updateStyle({ shadow })} />
        {style.shadow && <Slider label="Shadow blur" value={style.shadowBlur} min={0} max={40} unit="px" onChange={(shadowBlur) => updateStyle({ shadowBlur })} />}
      </Section>
      <Section title="Layout & motion">
        <Segmented
          label="Words at a time"
          value={style.wordsPerChunk}
          options={[{ value: 1, label: '1' }, { value: 2, label: '2' }, { value: 3, label: '3' }]}
          onChange={(wordsPerChunk) => updateStyle({ wordsPerChunk })}
        />
        <Slider label="Vertical position" value={style.y} min={0.05} max={0.95} step={0.01} format={pct} onChange={(y) => updateStyle({ y }, 'pos')} />
        <Slider label="Horizontal position" value={style.x} min={0.05} max={0.95} step={0.01} format={pct} onChange={(x) => updateStyle({ x }, 'pos')} />
        <Select<CaptionAnimation>
          label="Animation"
          value={style.animation}
          options={[
            { value: 'none', label: 'None' },
            { value: 'pop', label: 'Pop' },
            { value: 'bounce', label: 'Bounce' },
            { value: 'fade', label: 'Fade' },
            { value: 'typewriter', label: 'Typewriter' },
          ]}
          onChange={(animation) => updateStyle({ animation })}
        />
        <p className="text-[11px] leading-snug text-faint">Tip: drag the caption in the preview to reposition it. It snaps to the center line.</p>
      </Section>
    </>
  )
}

function TextProps({ item }: { item: TextItem }) {
  const fontOptions = useFontOptions()
  const docCommit = useDocCommit()
  const set = (fn: (t: Draft<TextItem>) => void, key?: string) => docCommit((d) => { const t = d.texts.find((x) => x.id === item.id); if (t) fn(t) }, key)
  return (
    <>
      <Section title="Content">
        <textarea
          value={item.text}
          onChange={(e) => set((t) => { t.text = e.target.value }, `text-${item.id}`)}
          rows={3}
          className="resize-none rounded-lg border border-line bg-raised p-2.5 text-[13px] outline-none focus:border-accent"
        />
        <Toggle label="Hook overlay (first seconds)" checked={item.isHook} onChange={(v) => set((t) => { t.isHook = v })} />
      </Section>
      <Section title="Style">
        <Select label="Font" value={item.fontFamily} options={fontOptions} onChange={(v) => set((t) => { t.fontFamily = v })} fontPreview />
        <Slider label="Size" value={item.fontSize} min={28} max={140} unit="px" onChange={(v) => set((t) => { t.fontSize = v }, `size-${item.id}`)} />
        <ColorField label="Text color" value={item.color} onChange={(v) => set((t) => { t.color = v })} />
        <Toggle label="Background box" checked={item.background !== null} onChange={(v) => set((t) => { t.background = v ? '#e2366f' : null })} />
        {item.background && <ColorField label="Box color" value={item.background} onChange={(v) => set((t) => { t.background = v })} />}
      </Section>
      <Section title="Position">
        <Slider label="Vertical" value={item.y} min={0.05} max={0.95} step={0.01} format={pct} onChange={(v) => set((t) => { t.y = v }, `y-${item.id}`)} />
        <Slider label="Horizontal" value={item.x} min={0.05} max={0.95} step={0.01} format={pct} onChange={(v) => set((t) => { t.x = v }, `x-${item.id}`)} />
      </Section>
    </>
  )
}

function AudioProps({ item }: { item: AudioItem }) {
  const docCommit = useDocCommit()
  const set = (fn: (a: Draft<AudioItem>) => void, key?: string) => docCommit((d) => { const a = d.audio.find((x) => x.id === item.id); if (a) fn(a) }, key)
  return (
    <>
      <Section title="Track">
        <div className="truncate text-[13px]">{item.name}</div>
        <Slider label="Volume" value={item.volume} min={0} max={1} step={0.01} format={pct} onChange={(v) => set((a) => { a.volume = v }, `vol-${item.id}`)} />
        <Slider label="Fade in" value={item.fadeIn} min={0} max={5} step={0.1} unit="s" onChange={(v) => set((a) => { a.fadeIn = v }, `fi-${item.id}`)} />
        <Slider label="Fade out" value={item.fadeOut} min={0} max={5} step={0.1} unit="s" onChange={(v) => set((a) => { a.fadeOut = v }, `fo-${item.id}`)} />
      </Section>
      <Section title="Auto-ducking">
        <Toggle label="Duck under speech" checked={item.ducking} onChange={(v) => set((a) => { a.ducking = v })} />
        {item.ducking && <Slider label="Duck amount" value={item.duckAmount} min={0.1} max={1} step={0.01} format={pct} onChange={(v) => set((a) => { a.duckAmount = v }, `duck-${item.id}`)} />}
        <p className="text-[11px] leading-snug text-faint">Music mixing is applied at export (Phase 8). Preview plays the original audio only.</p>
      </Section>
    </>
  )
}

const SIGNAL_LABELS: [keyof ClipSignals, string, string][] = [
  ['llm', 'Claude analysis', 'bg-accent'],
  ['text', 'Transcript', 'bg-track-caption'],
  ['audio', 'Audio energy', 'bg-track-audio'],
  ['visual', 'Visual motion', 'bg-track-video'],
]

function ScoreBreakdown({ signals }: { signals: ClipSignals }) {
  return (
    <Section title="Score breakdown">
      {SIGNAL_LABELS.map(([key, label, color]) => {
        const v = signals[key]
        return (
          <div key={key} className="flex flex-col gap-1">
            <div className="flex justify-between text-xs">
              <span className="text-muted">{label}</span>
              <span className="tabular-nums">{v === null ? <span className="text-faint">not used</span> : v}</span>
            </div>
            <div className="h-1.5 overflow-hidden rounded-full bg-raised">
              {v !== null && <div className={`h-full rounded-full ${color}`} style={{ width: `${v}%` }} />}
            </div>
          </div>
        )
      })}
      <p className="text-[11px] leading-snug text-faint">Weights live in backend/clipforge/analysis/scoring_weights.toml.</p>
    </Section>
  )
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-panel-2 px-2.5 py-2">
      <div className="text-[11px] text-faint">{label}</div>
      <div className="tabular-nums">{value}</div>
    </div>
  )
}
