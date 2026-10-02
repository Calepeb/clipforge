export const FPS = 30

/** 00:12:04 style timecode; frames appended when `frames` is set. */
export function formatTimecode(sec: number, frames = false): string {
  const s = Math.max(0, sec)
  const m = Math.floor(s / 60)
  const ss = Math.floor(s % 60)
  const base = `${String(m).padStart(2, '0')}:${String(ss).padStart(2, '0')}`
  if (!frames) return base
  const f = Math.floor((s % 1) * FPS)
  return `${base}:${String(f).padStart(2, '0')}`
}

export function formatDuration(sec: number): string {
  const m = Math.floor(sec / 60)
  const s = Math.round(sec % 60)
  return m ? `${m}:${String(s).padStart(2, '0')}` : `${s}s`
}

/** "just now", "5 min ago", "yesterday", or a date. */
export function timeAgo(ms: number, now = Date.now()): string {
  const s = Math.max(0, (now - ms) / 1000)
  if (s < 45) return 'just now'
  if (s < 3600) return `${Math.round(s / 60)} min ago`
  if (s < 86400) return `${Math.round(s / 3600)} h ago`
  if (s < 172800) return 'yesterday'
  return new Date(ms).toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}

export const clamp = (v: number, lo: number, hi: number) => Math.min(hi, Math.max(lo, v))

let idCounter = 0
export const uid = (prefix = 'id') => `${prefix}_${Date.now().toString(36)}${(idCounter++).toString(36)}`

/** Deterministic PRNG so mock data is stable between reloads. */
export function rng(seed: number) {
  let s = seed >>> 0
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0
    return s / 2 ** 32
  }
}

/** Filesystem-safe filename from a clip title. */
export function safeFilename(title: string): string {
  const name =
    title
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, '')
      .replace(/\s+/g, ' ')
      .slice(0, 80)
      .replace(/^[\s.]+|[\s.]+$/g, '') || 'clip' // Windows rejects trailing dots/spaces
  // Reserved device names on Windows (CON, NUL, COM1, ...) can't be file names.
  return /^(con|prn|aux|nul|com\d|lpt\d)$/i.test(name) ? `${name} clip` : name
}
