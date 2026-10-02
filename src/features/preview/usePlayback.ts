import { useEffect, type RefObject } from 'react'
import { docDuration, useEditor } from '../../stores/editorStore'
import type { Framing, VideoItem } from '../../types/editor'
import { splitFocus, trackFocus } from '../../lib/framing'
import { MusicMixer } from './musicMixer'
import { effectsOf, zoomAt, zoomIntervals } from '../../lib/effects'
import type { ClipEffects, TimelineDoc } from '../../types/editor'

const zoomMemo = new WeakMap<TimelineDoc, [number, number][]>()
/** Zoom intervals per doc version (the doc object changes on every edit). */
function zoomCache(doc: TimelineDoc, fx: ClipEffects) {
  let z = zoomMemo.get(doc)
  if (!z) zoomMemo.set(doc, (z = zoomIntervals(doc, fx)))
  return z
}

/**
 * Drives the editor clock and keeps a hidden <video> in sync with the timeline.
 * While a video segment plays, the video element is the master clock; across gaps
 * the clock advances on its own. Every frame is painted onto the preview canvas.
 */
export function usePlayback(videoRef: RefObject<HTMLVideoElement | null>, canvasRef: RefObject<HTMLCanvasElement | null>) {
  useEffect(() => {
    let raf = 0
    let last = performance.now()
    const mixer = new MusicMixer()

    const frame = (now: number) => {
      const dt = (now - last) / 1000
      last = now
      const video = videoRef.current
      const canvas = canvasRef.current
      const st = useEditor.getState()
      const doc = st.activeClipId ? st.data.docs[st.activeClipId] : undefined

      if (video && doc) {
        const dur = docDuration(doc)
        let t = st.time
        const seg = segmentAt(doc.video, t)

        if (st.playing) {
          if (seg && !video.paused && !video.seeking && video.readyState >= 2) {
            t = seg.start + (video.currentTime - seg.srcStart)
          } else {
            t += dt
          }
          // Hop to the next segment when the current one ends.
          if (seg && t >= seg.end) t = seg.end
          if (t >= dur) {
            t = dur
            st.setPlaying(false)
          }
          if (t !== st.time) useEditor.setState({ time: t })
        }

        // When parked exactly on a segment's end (e.g. end of clip), keep showing its last frame.
        const active = segmentAt(doc.video, t) ?? (st.playing ? undefined : doc.video.find((v) => Math.abs(t - v.end) < 1e-3))
        const media = active && st.media.find((m) => m.id === active.mediaId)
        if (active && media) {
          const url = new URL(media.src, location.href).href
          if (video.src !== url) video.src = url
          const expected = active.srcStart + (t - active.start)
          const drift = Math.abs(video.currentTime - expected)
          if (!video.seeking && (st.playing ? drift > 0.3 : drift > 0.01)) video.currentTime = expected
          video.volume = Math.min(1, active.volume)
          if (st.playing && video.paused) video.play().catch(() => undefined)
          if (!st.playing && !video.paused) video.pause()
        } else if (!video.paused) {
          video.pause()
        }

        mixer.update(doc, st.music, t, st.playing, dt)
        // Auto zoom: scale the finished frame from its centre, like the renderer's zoompan.
        if (canvas) {
          const fx = effectsOf(doc)
          const z = fx.zoom.enabled ? zoomAt(zoomCache(doc, fx), fx.zoom.amount, t) : 1
          const tf = z === 1 ? '' : `scale(${z})`
          if (canvas.style.transform !== tf) canvas.style.transform = tf
        }
        if (canvas) paint(canvas, video, active ? doc.framing : null, active ? active.srcStart + (t - active.start) : 0)
      }
      raf = requestAnimationFrame(frame)
    }
    raf = requestAnimationFrame(frame)
    return () => {
      cancelAnimationFrame(raf)
      mixer.stop()
    }
  }, [videoRef, canvasRef])
}

export function segmentAt(items: VideoItem[], t: number) {
  return items.find((v) => t >= v.start && t < v.end)
}

function drawCover(ctx: CanvasRenderingContext2D, v: HTMLVideoElement, dx: number, dy: number, dw: number, dh: number, focusX: number, zoom: number) {
  const vw = v.videoWidth
  const vh = v.videoHeight
  const scale = Math.max(dw / vw, dh / vh) * zoom
  const sw = dw / scale
  const sh = dh / scale
  ctx.drawImage(v, (vw - sw) * focusX, (vh - sh) / 2, sw, sh, dx, dy, dw, dh)
}

/** Composites the current video frame into the output frame for the chosen reframe mode. */
function paint(canvas: HTMLCanvasElement, v: HTMLVideoElement, framing: Framing | null, srcTime: number) {
  const dpr = window.devicePixelRatio || 1
  const W = Math.round(canvas.clientWidth * dpr)
  const H = Math.round(canvas.clientHeight * dpr)
  if (canvas.width !== W || canvas.height !== H) {
    canvas.width = W
    canvas.height = H
  }
  const ctx = canvas.getContext('2d')!
  ctx.fillStyle = '#000'
  ctx.fillRect(0, 0, W, H)
  if (!framing || v.readyState < 2 || !v.videoWidth) return

  const { mode, zoom } = framing
  if (mode === 'blur') {
    ctx.filter = 'blur(24px) brightness(0.55)'
    drawCover(ctx, v, -40, -40, W + 80, H + 80, 0.5, 1)
    ctx.filter = 'none'
    const s = Math.min(W / v.videoWidth, H / v.videoHeight) * zoom
    const dw = v.videoWidth * s
    const dh = v.videoHeight * s
    ctx.drawImage(v, (W - dw) / 2, (H - dh) / 2, dw, dh)
  } else if (mode === 'split') {
    const [top, bottom] = splitFocus(framing, v.videoWidth, v.videoHeight, W, H / 2)
    drawCover(ctx, v, 0, 0, W, H / 2, top, zoom)
    drawCover(ctx, v, 0, H / 2, W, H / 2, bottom, zoom)
    ctx.fillStyle = '#000'
    ctx.fillRect(0, H / 2 - dpr, W, 2 * dpr)
  } else {
    drawCover(ctx, v, 0, 0, W, H, trackFocus(framing, srcTime, v.videoWidth, v.videoHeight, W, H), zoom)
  }
}
