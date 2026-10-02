// Generates public/mock/sample.mp4: a 2-minute 16:9 test video with a tone track,
// used as the mock source in Phase 1. Requires FFmpeg on PATH.
import { spawnSync } from 'node:child_process'
import { mkdirSync, existsSync } from 'node:fs'

const out = 'public/mock/sample.mp4'
mkdirSync('public/mock', { recursive: true })
if (existsSync(out) && !process.argv.includes('--force')) {
  console.log(`${out} already exists (use --force to regenerate)`)
  process.exit(0)
}

const args = [
  '-y',
  '-f', 'lavfi', '-i', 'testsrc2=s=1280x720:r=30:d=120',
  '-f', 'lavfi', '-i', "aevalsrc='0.25*sin(2*PI*(180+60*sin(2*PI*t/7))*t)*(0.4+0.6*abs(sin(2*PI*t/3)))':s=44100:d=120",
  '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '30', '-pix_fmt', 'yuv420p',
  '-c:a', 'aac', '-b:a', '96k', '-movflags', '+faststart',
  out,
]
const r = spawnSync('ffmpeg', args, { stdio: 'inherit' })
if (r.error) {
  console.error('FFmpeg not found on PATH. Install it (see README) and retry.')
  process.exit(1)
}
process.exit(r.status ?? 1)
