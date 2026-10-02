import { useState } from 'react'
import clsx from 'clsx'
import { Check, Info, Wand2 } from 'lucide-react'
import { buildData, useEditor } from '../../stores/editorStore'
import { runMockJob, useUi } from '../../stores/uiStore'
import { useFrame } from '../../lib/media'
import { formatDuration } from '../../lib/time'
import { mockClips } from '../../mocks/data'
import { cancelJob, hasBackend, JobCancelledError, runJob, type GenerateResult } from '../../lib/backend'
import { buildGeneratedData } from '../../lib/generatedClips'
import { autoReframe } from '../../lib/reframe'
import { applyBrandKit } from '../../stores/brandStore'
import type { AiClip } from '../../types/editor'
import { Button, ScoreBadge, Select, Skeleton, Slider } from '../../components/ui/controls'
import { PanelHeader } from '../left-panel/LeftPanel'

export function AiClipsTab() {
  const clips = useEditor((s) => s.data.clips)
  const media = useEditor((s) => s.media)
  const replaceClips = useEditor((s) => s.replaceClips)
  const commit = useEditor((s) => s.commit)
  const toast = useUi((s) => s.toast)
  const genSourceId = useUi((s) => s.genSourceId)
  const setGenSource = useUi((s) => s.setGenSource)
  const [count, setCount] = useState(8)
  const [loading, setLoading] = useState(false)
  const [minLen, setMinLen] = useState(15)
  const [maxLen, setMaxLen] = useState(90)
  const [job, setJob] = useState<{ id: string; stage: string; progress: number } | null>(null)

  const ready = media.filter((m) => m.status === 'ready')
  const source = ready.find((m) => m.id === genSourceId) ?? ready[0]
  const allSelected = clips.length > 0 && clips.every((c) => c.selected)

  const generate = async () => {
    if (!source) return
    setLoading(true)
    try {
      if (source.path && hasBackend()) {
        // Real pipeline: transcribe → pick moments → Claude writes hooks & titles.
        const res = await runJob<GenerateResult>('/jobs/generate-clips', { path: source.path, count, min_len: minLen, max_len: maxLen }, (j) =>
          setJob({ id: j.id, stage: j.stage, progress: j.progress }),
        )
        useEditor.getState().updateMedia(source.id, { transcript: res.transcript })
        replaceClips(buildGeneratedData(source.id, res.clips))
        applyBrandKit()
        toast({
          kind: 'success',
          title: `${res.clips.length} clips ready`,
          body: res.note ?? `Captions transcribed (${res.language.toUpperCase()}) on the ${res.device === 'cuda' ? 'GPU' : 'CPU'}.`,
        })
        // Frame every clip around its speaker in the background.
        void autoReframe(useEditor.getState().data.clips.map((c) => c.id))
        if (res.warning) toast({ kind: 'info', title: res.claude ? 'Partly scored without Claude' : 'Scored without Claude', body: res.warning })
      } else {
        // Sample video or browser preview: no file on disk to transcribe, so use demo data.
        await runMockJob(`Find clips · ${source.name}`, ['Transcribing audio', 'Analyzing transcript', 'Scoring moments'], 2500)
        replaceClips(buildData(mockClips(count, source.id, source.duration).sort((a, b) => b.score - a.score)))
        toast({ kind: 'info', title: 'Demo clips', body: 'This video has no file on disk (sample or browser preview), so demo captions and hooks are used.' })
      }
    } catch (err) {
      if (err instanceof JobCancelledError) {
        toast({ kind: 'info', title: 'Clip generation cancelled' })
      } else {
        console.error('[generate]', err)
        toast({ kind: 'error', title: 'Could not generate clips', body: err instanceof Error ? err.message : String(err) })
      }
    } finally {
      setLoading(false)
      setJob(null)
    }
  }

  return (
    <>
      <PanelHeader title="AI Clips">
        {clips.length > 0 && (
          <button
            onClick={() => commit((d) => d.clips.forEach((c) => { c.selected = !allSelected }))}
            className="text-xs text-muted transition-colors hover:text-fg"
          >
            {allSelected ? 'Deselect all' : 'Select all'}
          </button>
        )}
      </PanelHeader>
      <div className="flex shrink-0 flex-col gap-3 border-b border-line p-3">
        {source && (
          <Select label="Source video" value={source.id} options={ready.map((m) => ({ value: m.id, label: m.name }))} onChange={setGenSource} />
        )}
        <Slider label="Number of clips" value={count} min={6} max={12} onChange={setCount} format={(v) => `${v}`} />
        <div className="grid grid-cols-2 gap-3">
          <Slider label="Min length" value={minLen} min={10} max={60} step={5} unit="s" onChange={(v) => { setMinLen(v); if (v + 10 > maxLen) setMaxLen(v + 10) }} />
          <Slider label="Max length" value={maxLen} min={20} max={120} step={5} unit="s" onChange={(v) => { setMaxLen(v); if (v - 10 < minLen) setMinLen(Math.max(10, v - 10)) }} />
        </div>
        <Button variant="primary" onClick={generate} disabled={loading || !source}>
          <Wand2 size={15} /> {loading ? 'Finding viral moments…' : clips.length ? 'Regenerate clips' : 'Generate clips'}
        </Button>
        {loading && job && (
          <div className="flex flex-col gap-1.5">
            <div className="flex items-center justify-between gap-2 text-xs text-muted">
              <span className="truncate">{job.stage}</span>
              <button onClick={() => cancelJob(job.id).catch(() => undefined)} className="shrink-0 text-faint hover:text-fg">
                Cancel
              </button>
            </div>
            <div className="h-1 overflow-hidden rounded-full bg-raised">
              <div className="h-full rounded-full bg-accent transition-[width]" style={{ width: `${job.progress * 100}%` }} />
            </div>
          </div>
        )}
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        {!source && !loading && clips.length === 0 && (
          <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-line-strong px-4 py-8 text-center">
            <div className="text-[13px] font-medium">No video yet</div>
            <div className="text-xs text-faint">Import a video in Media, then generate clips here.</div>
            <Button size="sm" onClick={() => useUi.getState().setLeftTab('media')}>Go to Media</Button>
          </div>
        )}
        <div className="grid grid-cols-2 gap-2.5">
          {loading
            ? Array.from({ length: count }, (_, i) => (
                <div key={i} className="flex flex-col gap-1.5">
                  <Skeleton className="aspect-[9/16]" />
                  <Skeleton className="h-3 w-4/5" />
                </div>
              ))
            : clips.map((c, i) => <ClipCard key={c.id} clip={c} rank={i + 1} />)}
        </div>
      </div>
    </>
  )
}

function ClipCard({ clip, rank }: { clip: AiClip; rank: number }) {
  const src = useEditor((s) => s.media.find((m) => m.id === clip.mediaId)?.src)
  const active = useEditor((s) => s.activeClipId === clip.id)
  const openClip = useEditor((s) => s.openClip)
  const commit = useEditor((s) => s.commit)
  const thumb = useFrame(src, clip.srcStart + 1, 320)

  return (
    <div className="group flex animate-fade-in flex-col gap-1.5">
      <div
        role="button"
        tabIndex={0}
        onClick={() => openClip(clip.id)}
        onKeyDown={(e) => e.key === 'Enter' && openClip(clip.id)}
        className={clsx(
          'relative aspect-[9/16] cursor-pointer overflow-hidden rounded-lg border-2 bg-app transition-all',
          active ? 'border-accent shadow-[0_0_0_3px_rgb(255_106_61/0.18)]' : 'border-transparent hover:border-line-strong',
        )}
      >
        {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105" /> : <div className="skeleton h-full w-full" />}
        <div className="absolute inset-x-0 bottom-0 h-1/3 bg-gradient-to-t from-black/80 to-transparent" />
        <ScoreBadge score={clip.score} className="absolute left-1.5 top-1.5" />
        <button
          onClick={(e) => { e.stopPropagation(); commit((d) => { const c = d.clips.find((x) => x.id === clip.id)!; c.selected = !c.selected }) }}
          aria-label={clip.selected ? 'Exclude from export' : 'Include in export'}
          className={clsx(
            'absolute right-1.5 top-1.5 flex h-5 w-5 items-center justify-center rounded-md border transition-colors',
            clip.selected ? 'border-accent bg-accent text-white' : 'border-white/50 bg-black/40 text-transparent hover:border-white',
          )}
        >
          <Check size={13} strokeWidth={3} />
        </button>
        <span className="absolute bottom-1.5 left-1.5 text-[10.5px] font-medium text-white/70">#{rank}</span>
        <span className="absolute bottom-1.5 right-1.5 rounded bg-black/60 px-1 text-[10.5px] tabular-nums">{formatDuration(clip.srcEnd - clip.srcStart)}</span>
        <WhyViral clip={clip} />
      </div>
      <div className="line-clamp-2 text-xs font-medium leading-snug" title={clip.title}>{clip.title}</div>
    </div>
  )
}

/** Hovering the info icon reveals the reason as an overlay on the card (no clipping in the scroll panel). */
function WhyViral({ clip }: { clip: AiClip }) {
  return (
    <>
      <span className="peer absolute bottom-7 left-1.5 z-10 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white/80 opacity-0 transition-opacity group-hover:opacity-100">
        <Info size={12} />
      </span>
      <div className="pointer-events-none absolute inset-0 flex flex-col justify-end bg-black/85 p-2.5 opacity-0 backdrop-blur-sm transition-opacity peer-hover:opacity-100">
        <div className="mb-1 text-[10.5px] font-semibold uppercase tracking-wide text-accent">Why it's viral</div>
        <div className="text-xs leading-snug text-fg">{clip.reason}</div>
        <div className="mt-1.5 text-[10.5px] leading-snug text-track-video">{clip.hashtags.join(' ')}</div>
        <div className="h-6" />
      </div>
    </>
  )
}
