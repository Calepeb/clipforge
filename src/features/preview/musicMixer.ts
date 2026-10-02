// Preview playback for music items: one <audio> per item, synced to the timeline,
// looping when the clip is longer than the track, with fades and auto-ducking.
// The export does the same mix with FFmpeg (backend/clipforge/render/clip.py).
import type { MusicAsset, TimelineDoc } from '../../types/editor'
import { timelineWords } from '../../lib/timelineWords'

const DUCK_SPEED = 8          // 1/s — how fast the music dips and recovers (~125 ms)
const SPEECH_PAD = [0.15, 0.3] // seconds before/after a word that count as speech

export class MusicMixer {
  private players = new Map<string, { el: HTMLAudioElement; gain: number }>()

  update(doc: TimelineDoc | undefined, music: MusicAsset[], t: number, playing: boolean, dt: number) {
    const items = doc?.audio.filter((a) => a.musicId) ?? []
    // Drop players for items that no longer exist.
    for (const [id, p] of this.players) {
      if (!items.some((a) => a.id === id)) {
        p.el.pause()
        this.players.delete(id)
      }
    }
    if (!doc) return
    const words = timelineWords(doc)
    const speaking = words.some((w) => t >= w.start - SPEECH_PAD[0] && t <= w.end + SPEECH_PAD[1])

    for (const item of items) {
      const asset = music.find((m) => m.id === item.musicId)
      if (!asset || asset.status !== 'ready' || !asset.duration) continue
      let p = this.players.get(item.id)
      if (!p) {
        const el = new Audio(asset.src)
        el.preload = 'auto'
        p = { el, gain: 1 }
        this.players.set(item.id, p)
      }
      const inside = t >= item.start && t < item.end
      if (!playing || !inside) {
        if (!p.el.paused) p.el.pause()
        continue
      }
      const target = item.ducking && speaking ? 1 - item.duckAmount : 1
      p.gain += (target - p.gain) * Math.min(1, dt * DUCK_SPEED)
      const local = t - item.start
      const fade = Math.min(1, item.fadeIn ? local / item.fadeIn : 1, item.fadeOut ? (item.end - t) / item.fadeOut : 1)
      p.el.volume = Math.max(0, Math.min(1, item.volume * fade * p.gain))
      const expected = local % asset.duration
      if (Math.abs(p.el.currentTime - expected) > 0.3) p.el.currentTime = expected
      if (p.el.paused) p.el.play().catch(() => undefined)
    }
  }

  stop() {
    for (const p of this.players.values()) p.el.pause()
    this.players.clear()
  }
}
