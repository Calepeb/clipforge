import { useEffect, useRef } from 'react'
import { PEAKS_PER_SEC } from '../../lib/media'

/**
 * Draws peaks[from..to] (in seconds) as a mirrored waveform filling the element.
 * Colour comes from CSS `color` so tracks can tint it.
 */
export function Waveform({ peaks, from = 0, to, className }: { peaks?: Float32Array; from?: number; to?: number; className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null)
  useEffect(() => {
    const canvas = ref.current
    if (!canvas || !peaks) return
    const draw = () => {
      const dpr = window.devicePixelRatio || 1
      const w = canvas.clientWidth
      const h = canvas.clientHeight
      if (!w || !h) return
      canvas.width = w * dpr
      canvas.height = h * dpr
      const ctx = canvas.getContext('2d')!
      ctx.scale(dpr, dpr)
      ctx.fillStyle = getComputedStyle(canvas).color
      const i0 = Math.floor(from * PEAKS_PER_SEC)
      const i1 = Math.min(peaks.length, Math.ceil((to ?? peaks.length / PEAKS_PER_SEC) * PEAKS_PER_SEC))
      const n = Math.max(1, i1 - i0)
      const bar = 2
      for (let x = 0; x < w; x += bar + 1) {
        const a = i0 + Math.floor((x / w) * n)
        const b = i0 + Math.floor(((x + bar) / w) * n)
        let m = 0
        for (let i = a; i <= b && i < i1; i++) m = Math.max(m, peaks[i] ?? 0)
        const bh = Math.max(1, m * h * 0.92)
        ctx.fillRect(x, (h - bh) / 2, bar, bh)
      }
    }
    draw()
    const ro = new ResizeObserver(draw)
    ro.observe(canvas)
    return () => ro.disconnect()
  }, [peaks, from, to])
  return <canvas ref={ref} className={className} />
}
