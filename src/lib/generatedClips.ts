import type { ProjectData } from '../stores/editorStore'
import type { AiClip, TimelineDoc } from '../types/editor'
import type { GeneratedClip } from './backend'
import { CAPTION_PRESETS } from './captions'
import { uid } from './time'

const HOOK_SECONDS = 3

/** Turns backend results into editor clips: real word-timed captions + a hook text layer. */
export function buildGeneratedData(mediaId: string, generated: GeneratedClip[]): ProjectData {
  const data: ProjectData = { clips: [], docs: {}, styles: {} }
  // Backend returns clips best-first; pre-select the top three quarters for export.
  const preselect = Math.ceil(generated.length * 0.75)
  generated.forEach((g, rank) => {
    const id = uid('clip')
    const duration = +(g.end - g.start).toFixed(3)
    const clip: AiClip = {
      id,
      mediaId,
      title: g.title,
      score: g.score,
      reason: g.reason,
      hashtags: g.hashtags,
      srcStart: g.start,
      srcEnd: g.end,
      selected: rank < preselect,
      signals: g.signals,
    }
    const doc: TimelineDoc = {
      video: [{ id: uid('v'), mediaId, start: 0, end: duration, srcStart: g.start, volume: 1 }],
      // Stored in source time, like the backend sends them (see lib/timelineWords.ts).
      words: g.words.map((w, i) => ({ id: `${id}_w${i}`, text: w.text, start: w.start, end: w.end })),
      texts: g.hook
        ? [{
            id: uid('t'),
            start: 0,
            end: Math.min(HOOK_SECONDS, duration),
            text: g.hook,
            fontFamily: 'Poppins',
            fontSize: 64,
            color: '#ffffff',
            background: '#e2366f',
            x: 0.5,
            y: 0.16,
            isHook: true,
          }]
        : [],
      audio: [],
      framing: { mode: 'track', focusX: 0.5, zoom: 1 },
      progressBar: true,
    }
    data.clips.push(clip)
    data.docs[id] = doc
    data.styles[id] = { ...CAPTION_PRESETS[0].style }
  })
  return data
}
