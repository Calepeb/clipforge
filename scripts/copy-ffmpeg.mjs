// Copies FFmpeg (and its license, if found) into build/ffmpeg for the installer.
// Uses $FFMPEG_PATH if set (CI points it at a static build), otherwise the ffmpeg on PATH.
// It must be a self-contained (static) build: Homebrew's ffmpeg depends on other Homebrew
// libraries and won't run on other Macs.
import { execSync } from 'node:child_process'
import { chmodSync, cpSync, existsSync, mkdirSync, realpathSync } from 'node:fs'
import path from 'node:path'

const win = process.platform === 'win32'
const exe = win ? 'ffmpeg.exe' : 'ffmpeg'
const source = realpathSync(process.env.FFMPEG_PATH || execSync(win ? 'where ffmpeg' : 'command -v ffmpeg', { shell: win ? undefined : '/bin/sh' }).toString().split(/\r?\n/)[0].trim())

const out = path.join('build', 'ffmpeg')
mkdirSync(out, { recursive: true })
// Only ffmpeg is used at runtime (durations come from PyAV), so ffprobe isn't shipped.
cpSync(source, path.join(out, exe))
if (!win) chmodSync(path.join(out, exe), 0o755)
// gyan.dev zips keep LICENSE next to bin/; ffmpeg-static ships <binary>.LICENSE beside it.
for (const lic of [`${source}.LICENSE`, path.join(path.dirname(path.dirname(source)), 'LICENSE'), path.join(path.dirname(source), 'LICENSE')]) {
  if (existsSync(lic)) {
    cpSync(lic, path.join(out, 'LICENSE.txt'))
    break
  }
}
console.log(`FFmpeg copied from ${source} to ${out}`)
