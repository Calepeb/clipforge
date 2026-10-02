import type { CaptionStyle, Word } from '../types/editor'

export interface CaptionChunk {
  id: string
  words: Word[]
  start: number
  end: number
  text: string
}

/** Gap (s) that always starts a new caption chunk, regardless of words-per-chunk. */
const PAUSE_BREAK = 0.6

export function chunkWords(words: Word[], perChunk: number): CaptionChunk[] {
  const chunks: CaptionChunk[] = []
  let cur: Word[] = []
  const flush = () => {
    if (!cur.length) return
    chunks.push({
      id: cur[0].id,
      words: cur,
      start: cur[0].start,
      end: cur[cur.length - 1].end,
      text: cur.map((w) => w.text).join(' '),
    })
    cur = []
  }
  for (const w of words) {
    const prev = cur[cur.length - 1]
    const sentenceEnd = prev && /[.!?]$/.test(prev.text)
    if (prev && (w.start - prev.end > PAUSE_BREAK || sentenceEnd || cur.length >= perChunk)) flush()
    cur.push(w)
  }
  flush()
  return chunks
}

/**
 * Replace a chunk's words with corrected text. Same word count keeps the original
 * timings; otherwise the chunk's time span is split evenly across the new words.
 */
export function replaceChunkText(words: Word[], chunk: CaptionChunk, text: string): Word[] {
  const tokens = text.trim().split(/\s+/).filter(Boolean)
  const ids = new Set(chunk.words.map((w) => w.id))
  // `words` are the stored (source-time) words; the chunk came from the timeline view.
  const stored = words.filter((w) => ids.has(w.id)).sort((a, b) => a.start - b.start)
  if (!stored.length) return words
  let next: Word[]
  if (tokens.length === stored.length) {
    next = stored.map((w, i) => ({ ...w, text: tokens[i] }))
  } else {
    const a = stored[0].start
    const b = stored[stored.length - 1].end
    const step = (b - a) / Math.max(1, tokens.length)
    next = tokens.map((t, i) => ({
      id: i === 0 ? stored[0].id : `${stored[0].id}_${i}_${Date.now().toString(36)}`,
      text: t,
      start: +(a + i * step).toFixed(3),
      end: +(a + (i + 1) * step - 0.02).toFixed(3),
    }))
  }
  return [...words.filter((w) => !ids.has(w.id)), ...next].sort((x, y) => x.start - y.start)
}

export function chunkAt(chunks: CaptionChunk[], t: number): CaptionChunk | undefined {
  return chunks.find((c) => t >= c.start && t < c.end + 0.12)
}

const KEYWORDS = new Set([
  'never', 'always', 'secret', 'money', 'million', 'insane', 'crazy', 'biggest', 'worst',
  'best', 'mistake', 'truth', 'free', 'nobody', 'everyone', 'wrong', 'love', 'hate', 'fail',
  'win', 'stop', 'why', 'actually', 'impossible', 'huge',
])

export function isKeyword(text: string): boolean {
  return KEYWORDS.has(text.toLowerCase().replace(/[^a-z]/g, ''))
}

const EMOJI: Record<string, string> = {
  money: '💰', million: '💰', fire: '🔥', crazy: '🤯', insane: '🤯', love: '❤️', laugh: '😂',
  funny: '😂', secret: '🤫', mistake: '😬', win: '🏆', fail: '💀', idea: '💡', stop: '✋',
  wrong: '❌', truth: '👀', time: '⏰', biggest: '🚀',
}

export function emojiFor(text: string): string | undefined {
  return EMOJI[text.toLowerCase().replace(/[^a-z]/g, '')]
}

export const CAPTION_FONTS = ['Montserrat', 'Poppins', 'Inter', 'Bebas Neue', 'Anton']

const base: CaptionStyle = {
  presetId: 'spotlight',
  fontFamily: 'Montserrat',
  fontSize: 72,
  fontWeight: 900,
  uppercase: true,
  textColor: '#ffffff',
  highlightColor: '#ffd23f',
  highlightMode: 'word',
  outlineColor: '#000000',
  outlineWidth: 6,
  shadow: true,
  shadowBlur: 12,
  wordsPerChunk: 3,
  keywordEmphasis: false,
  keywordColor: '#3ee08f',
  emojis: false,
  animation: 'pop',
  x: 0.5,
  y: 0.7,
}

export const CAPTION_PRESETS: { id: string; name: string; style: CaptionStyle }[] = [
  { id: 'spotlight', name: 'Spotlight', style: base },
  {
    id: 'punch',
    name: 'Punch',
    style: { ...base, presetId: 'punch', wordsPerChunk: 1, fontSize: 96, highlightMode: 'none', animation: 'bounce', fontFamily: 'Anton', fontWeight: 400 },
  },
  {
    id: 'duo',
    name: 'Duo',
    style: { ...base, presetId: 'duo', wordsPerChunk: 2, highlightColor: '#ff6a8b', animation: 'pop', fontFamily: 'Poppins', fontWeight: 800 },
  },
  {
    id: 'outline',
    name: 'Heavy Outline',
    style: { ...base, presetId: 'outline', highlightMode: 'none', outlineWidth: 10, shadow: false, animation: 'fade', fontSize: 80 },
  },
  {
    id: 'keyword',
    name: 'Keyword Pop',
    style: { ...base, presetId: 'keyword', highlightMode: 'none', keywordEmphasis: true, uppercase: false, fontFamily: 'Poppins', fontWeight: 800, animation: 'pop' },
  },
  {
    id: 'emoji',
    name: 'Emoji Burst',
    style: { ...base, presetId: 'emoji', emojis: true, highlightColor: '#7cd4ff', wordsPerChunk: 2, animation: 'bounce' },
  },
  {
    id: 'type',
    name: 'Typewriter',
    style: { ...base, presetId: 'type', uppercase: false, highlightMode: 'none', fontFamily: 'Inter', fontWeight: 700, fontSize: 60, outlineWidth: 0, shadow: true, animation: 'typewriter' },
  },
  {
    id: 'cinema',
    name: 'Cinema',
    style: { ...base, presetId: 'cinema', fontFamily: 'Bebas Neue', fontWeight: 400, fontSize: 88, highlightMode: 'none', outlineWidth: 0, shadow: true, shadowBlur: 20, animation: 'fade', y: 0.82 },
  },
]
