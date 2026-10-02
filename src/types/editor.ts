export type AspectRatio = '9:16' | '1:1' | '16:9'

export interface MediaAsset {
  id: string
  name: string
  /** URL the renderer plays (cf-media://, blob: or a bundled path). Rebuilt from `path` on load. */
  src: string
  /** Absolute file path on disk (desktop app only). */
  path?: string
  duration: number
  width?: number
  height?: number
  status: 'ready' | 'processing' | 'missing'
  /** Full transcript in source time (from clip generation). Lets trims reveal more captions. */
  transcript?: { text: string; start: number; end: number }[]
}

export interface Word {
  id: string
  text: string
  /** Seconds. Stored caption words use SOURCE time; see lib/timelineWords.ts. */
  start: number
  end: number
}

export interface VideoItem {
  id: string
  mediaId: string
  start: number
  end: number
  /** Source time that maps to `start`. */
  srcStart: number
  volume: number
}

export interface TextItem {
  id: string
  start: number
  end: number
  text: string
  fontFamily: string
  fontSize: number
  color: string
  background: string | null
  x: number
  y: number
  isHook: boolean
}

/** A music file imported into the project (Audio tab). */
export interface MusicAsset {
  id: string
  name: string
  src: string
  path?: string
  duration: number
  status: 'ready' | 'processing' | 'missing'
}

export interface AudioItem {
  id: string
  name: string
  /** The imported music this item plays (loops if shorter than the item). */
  musicId?: string
  start: number
  end: number
  volume: number
  fadeIn: number
  fadeOut: number
  ducking: boolean
  duckAmount: number
  seed: number
}

export type ReframeMode = 'track' | 'center' | 'blur' | 'split'

export interface Framing {
  mode: ReframeMode
  /** Horizontal focus for manual 'track' framing, 0 = left edge, 1 = right edge. */
  focusX: number
  zoom: number
  /** Auto-reframe camera path: subject centre x (0..1 of source width) at source time t. */
  keyframes?: { t: number; x: number }[]
  /** Subject centres for the top/bottom halves of split-screen. */
  splitX?: [number, number] | null
  /** Result of the last auto-reframe run, shown in the properties panel. */
  auto?: { mode: ReframeMode; reason: string; faces: number } | null
}

export interface TimelineDoc {
  video: VideoItem[]
  /** Caption words in source-video time, mapped onto the timeline via `video`. */
  words: Word[]
  texts: TextItem[]
  audio: AudioItem[]
  framing: Framing
  progressBar: boolean
  /** Effects tab settings (zoom punch-ins, colour, vignette, fades, loudness). */
  effects?: ClipEffects
  /** Set while silence/filler removal is on: what was cut, and the layout to restore. */
  tightened?: {
    removed: number
    fillers: number
    original: { video: VideoItem[]; texts: TextItem[]; audio: AudioItem[] }
  } | null
}

export interface ClipEffects {
  zoom: { enabled: boolean; amount: number; trigger: 'sentence' | 'keyword' | 'interval'; interval: number }
  color: { preset: string; brightness: number; contrast: number; saturation: number; warmth: number }
  vignette: number
  fadeIn: number
  fadeOut: number
  normalizeAudio: boolean
}

export type CaptionAnimation = 'none' | 'pop' | 'bounce' | 'fade' | 'typewriter'

export interface CaptionStyle {
  presetId: string
  fontFamily: string
  fontSize: number
  fontWeight: number
  uppercase: boolean
  textColor: string
  highlightColor: string
  highlightMode: 'word' | 'none'
  outlineColor: string
  outlineWidth: number
  shadow: boolean
  shadowBlur: number
  wordsPerChunk: 1 | 2 | 3
  keywordEmphasis: boolean
  keywordColor: string
  emojis: boolean
  animation: CaptionAnimation
  x: number
  y: number
}

export interface AiClip {
  id: string
  mediaId: string
  title: string
  score: number
  reason: string
  hashtags: string[]
  srcStart: number
  srcEnd: number
  selected: boolean
  /** 0-100 per detection signal; null = not available for this run (e.g. no Claude key). */
  signals?: ClipSignals
}

export interface ClipSignals {
  llm: number | null
  text: number | null
  audio: number | null
  visual: number | null
}

export type Selection =
  | { kind: 'video'; id: string }
  | { kind: 'caption'; id: string }
  | { kind: 'text'; id: string }
  | { kind: 'audio'; id: string }
  | null

export type TrackKind = 'text' | 'caption' | 'video' | 'audio'
