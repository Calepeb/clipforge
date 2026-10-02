// Turns a clip's edit document into the backend's render request (backend/clipforge/render/clip.py).
import { useEditor } from '../stores/editorStore'
import { useBrand } from '../stores/brandStore'
import { chunkWords } from './captions'
import { timelineWords } from './timelineWords'
import { colorTransform, effectsOf, zoomIntervals } from './effects'

export interface RenderSpec {
  media_path: string
  source_width: number
  source_height: number
  aspect: '9:16' | '1:1' | '16:9'
  segments: { src_start: number; start: number; end: number; volume: number }[]
  framing: { mode: string; focus_x: number; zoom: number; keyframes: { t: number; x: number }[]; split_x: [number, number] | null }
  words: { text: string; start: number; end: number }[]
  caption_style: Record<string, unknown> | null
  texts: Record<string, unknown>[]
  progress_bar: boolean
  output_path?: string
  music: { path: string; start: number; end: number; volume: number; fade_in: number; fade_out: number; ducking: boolean; duck_amount: number }[]
  watermark: { path: string; corner: string; size: number; opacity: number } | null
  effects: {
    zoom_intervals: [number, number][]
    zoom_amount: number
    color: { matrix: number[]; offset: [number, number, number] } | null
    vignette: number
    fade_in: number
    fade_out: number
    normalize_audio: boolean
  }
  /** SubRip text written next to output_path. */
  srt?: string
}

export class RenderSpecError extends Error {}

export function buildRenderSpec(clipId: string, outputPath?: string): RenderSpec {
  const { data, media, music, aspect } = useEditor.getState()
  const doc = data.docs[clipId]
  const style = data.styles[clipId]
  if (!doc || !doc.video.length) throw new RenderSpecError('This clip has no video on the timeline.')
  const ids = new Set(doc.video.map((v) => v.mediaId))
  if (ids.size > 1) throw new RenderSpecError('Rendering clips that mix several source videos isn’t supported yet.')
  const asset = media.find((m) => m.id === doc.video[0].mediaId)
  if (!asset?.path) throw new RenderSpecError('This video has no file on disk (sample or browser preview), so it can’t be rendered.')
  if (asset.status === 'missing') throw new RenderSpecError(`The source video is missing: ${asset.path}`)
  if (!asset.width || !asset.height) throw new RenderSpecError('The source video’s size is unknown. Re-import it in Media.')

  return {
    media_path: asset.path,
    source_width: asset.width,
    source_height: asset.height,
    aspect,
    segments: doc.video.map((v) => ({ src_start: v.srcStart, start: v.start, end: v.end, volume: v.volume })),
    framing: {
      mode: doc.framing.mode,
      focus_x: doc.framing.focusX,
      zoom: doc.framing.zoom,
      keyframes: doc.framing.keyframes ?? [],
      split_x: doc.framing.splitX ?? null,
    },
    words: timelineWords(doc).map((w) => ({ text: w.text, start: w.start, end: w.end })),
    caption_style: timelineWords(doc).length ? { ...style } : null,
    texts: doc.texts.map((t) => ({ ...t })),
    progress_bar: doc.progressBar,
    // Music with a file on disk; placeholder items from old projects are skipped.
    music: doc.audio.flatMap((a) => {
      const m = music.find((x) => x.id === a.musicId)
      return m?.path && m.status === 'ready'
        ? [{ path: m.path, start: a.start, end: a.end, volume: a.volume, fade_in: a.fadeIn, fade_out: a.fadeOut, ducking: a.ducking, duck_amount: a.duckAmount }]
        : []
    }),
    watermark: (() => {
      const wm = useBrand.getState().kit.watermark
      return wm?.enabled ? { path: wm.path, corner: wm.corner, size: wm.size, opacity: wm.opacity } : null
    })(),
    effects: (() => {
      const fx = effectsOf(doc)
      return {
        zoom_intervals: zoomIntervals(doc, fx),
        zoom_amount: fx.zoom.amount,
        color: colorTransform(fx.color),
        vignette: fx.vignette,
        fade_in: fx.fadeIn,
        fade_out: fx.fadeOut,
        normalize_audio: fx.normalizeAudio,
      }
    })(),
    output_path: outputPath,
  }
}

/** SubRip text using the same chunks as the on-screen captions. */
export function buildSrt(clipId: string): string {
  const { data } = useEditor.getState()
  const doc = data.docs[clipId]
  const per = data.styles[clipId]?.wordsPerChunk ?? 3
  const t = (x: number) => {
    const ms = Math.round(Math.max(0, x) * 1000)
    const p = (n: number, l = 2) => String(n).padStart(l, '0')
    return `${p(Math.floor(ms / 3_600_000))}:${p(Math.floor(ms / 60_000) % 60)}:${p(Math.floor(ms / 1000) % 60)},${p(ms % 1000, 3)}`
  }
  const chunks = chunkWords(doc ? timelineWords(doc) : [], per)
  // Captions linger 0.12 s on screen, but SRT entries must not overlap the next one.
  return chunks
    .map((c, i) => {
      const end = Math.min(c.end + 0.12, chunks[i + 1]?.start ?? Infinity)
      return `${i + 1}\n${t(c.start)} --> ${t(Math.max(end, c.start + 0.05))}\n${c.text}\n`
    })
    .join('\n')
}
