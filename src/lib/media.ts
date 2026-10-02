// Browser-side thumbnails and waveforms for Phase 1.
// From Phase 2 the backend generates these with FFmpeg (fast for multi-hour files).
import { useEffect, useState } from 'react'
import { rng } from './time'

const frameCache = new Map<string, string>()
const grabbers = new Map<string, { video: HTMLVideoElement; queue: Promise<unknown> }>()

function grabber(src: string) {
  let g = grabbers.get(src)
  if (!g) {
    const video = document.createElement('video')
    video.muted = true
    video.preload = 'auto'
    // cf-media:// is cross-origin; CORS keeps the canvas readable for toDataURL.
    video.crossOrigin = 'anonymous'
    video.src = src
    g = { video, queue: Promise.resolve() }
    grabbers.set(src, g)
  }
  return g
}

function once(el: HTMLVideoElement, event: string) {
  return new Promise<void>((resolve, reject) => {
    const ok = () => { cleanup(); resolve() }
    const err = () => { cleanup(); reject(new Error(`video ${event} failed`)) }
    const cleanup = () => { el.removeEventListener(event, ok); el.removeEventListener('error', err) }
    el.addEventListener(event, ok)
    el.addEventListener('error', err)
  })
}

/** Grab one frame as a JPEG data URL. Requests for the same source are serialized. */
export function grabFrame(src: string, time: number, width = 160): Promise<string> {
  const key = `${src}@${time.toFixed(1)}@${width}`
  const cached = frameCache.get(key)
  if (cached) return Promise.resolve(cached)
  const g = grabber(src)
  const job = g.queue.then(async () => {
    const v = g.video
    if (v.readyState < 1) await once(v, 'loadedmetadata')
    v.currentTime = Math.min(Math.max(0, time), Math.max(0, v.duration - 0.05))
    await once(v, 'seeked')
    const canvas = document.createElement('canvas')
    canvas.width = width
    canvas.height = Math.round((width * v.videoHeight) / v.videoWidth) || Math.round(width * 0.5625)
    canvas.getContext('2d')!.drawImage(v, 0, 0, canvas.width, canvas.height)
    const url = canvas.toDataURL('image/jpeg', 0.7)
    frameCache.set(key, url)
    return url
  })
  g.queue = job.catch(() => undefined)
  return job
}

export function useFrames(src: string | undefined, times: number[], width = 160): (string | undefined)[] {
  const key = times.map((t) => t.toFixed(1)).join(',')
  const [frames, setFrames] = useState<(string | undefined)[]>([])
  useEffect(() => {
    if (!src) return
    let alive = true
    setFrames(times.map((t) => frameCache.get(`${src}@${t.toFixed(1)}@${width}`)))
    times.forEach((t, i) =>
      grabFrame(src, t, width)
        .then((url) => alive && setFrames((f) => { const n = [...f]; n[i] = url; return n }))
        .catch(() => undefined),
    )
    return () => { alive = false }
  }, [src, key, width])
  return frames
}

export const useFrame = (src: string | undefined, time: number, width = 160) => useFrames(src, [time], width)[0]

export const PEAKS_PER_SEC = 50
const peakCache = new Map<string, Promise<Float32Array>>()

/** Decode a media file's audio and reduce it to normalized peak values. */
export function getPeaks(src: string): Promise<Float32Array> {
  let p = peakCache.get(src)
  if (!p) {
    p = (async () => {
      const buf = await (await fetch(src)).arrayBuffer()
      const ctx = new OfflineAudioContext(1, 1, 8000)
      const audio = await ctx.decodeAudioData(buf)
      const data = audio.getChannelData(0)
      const bucket = Math.floor(audio.sampleRate / PEAKS_PER_SEC)
      const peaks = new Float32Array(Math.ceil(data.length / bucket))
      let max = 0
      for (let i = 0; i < peaks.length; i++) {
        let m = 0
        for (let j = i * bucket, e = Math.min(data.length, j + bucket); j < e; j++) m = Math.max(m, Math.abs(data[j]))
        peaks[i] = m
        max = Math.max(max, m)
      }
      if (max > 0) for (let i = 0; i < peaks.length; i++) peaks[i] /= max
      return peaks
    })()
    peakCache.set(src, p)
  }
  return p
}

export function useWaveform(src: string | undefined) {
  const [peaks, setPeaks] = useState<Float32Array>()
  useEffect(() => {
    if (!src) return
    let alive = true
    getPeaks(src).then((p) => alive && setPeaks(p)).catch(() => undefined)
    return () => { alive = false }
  }, [src])
  return peaks
}

/** Synthetic waveform for placeholder music tracks. */
export function syntheticPeaks(seed: number, seconds: number): Float32Array {
  const r = rng(seed)
  const n = Math.ceil(seconds * PEAKS_PER_SEC)
  const out = new Float32Array(n)
  for (let i = 0; i < n; i++) {
    const beat = Math.abs(Math.sin((i / PEAKS_PER_SEC) * Math.PI * 2)) ** 3
    out[i] = Math.min(1, 0.25 + 0.5 * beat + 0.25 * r())
  }
  return out
}

/** Read a dropped/selected video file's metadata via a temporary element. */
export function probeVideo(src: string): Promise<{ duration: number; width: number; height: number }> {
  const v = document.createElement('video')
  v.preload = 'metadata'
  v.src = src
  return once(v, 'loadedmetadata').then(() => ({ duration: v.duration, width: v.videoWidth, height: v.videoHeight }))
}
