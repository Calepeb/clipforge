// Downloads the caption fonts (SIL Open Font License) from the official google/fonts repo
// into public/fonts. The preview loads them via @font-face and the FFmpeg/libass renderer
// uses the same files, so burned-in captions match what you see in the editor.
// Usage: npm run fetch:fonts
import { mkdirSync, existsSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const BASE = 'https://raw.githubusercontent.com/google/fonts/main/ofl'
const FILES = [
  ['montserrat/Montserrat[wght].ttf', 'Montserrat[wght].ttf'],
  ['montserrat/OFL.txt', 'OFL-Montserrat.txt'],
  ['poppins/Poppins-SemiBold.ttf', 'Poppins-SemiBold.ttf'],
  ['poppins/Poppins-Bold.ttf', 'Poppins-Bold.ttf'],
  ['poppins/Poppins-ExtraBold.ttf', 'Poppins-ExtraBold.ttf'],
  ['poppins/Poppins-Black.ttf', 'Poppins-Black.ttf'],
  ['poppins/OFL.txt', 'OFL-Poppins.txt'],
  ['inter/Inter[opsz,wght].ttf', 'Inter[opsz,wght].ttf'],
  ['inter/OFL.txt', 'OFL-Inter.txt'],
  ['bebasneue/BebasNeue-Regular.ttf', 'BebasNeue-Regular.ttf'],
  ['bebasneue/OFL.txt', 'OFL-BebasNeue.txt'],
  ['anton/Anton-Regular.ttf', 'Anton-Regular.ttf'],
  ['anton/OFL.txt', 'OFL-Anton.txt'],
]

const dir = path.join('public', 'fonts')
mkdirSync(dir, { recursive: true })
let failed = 0
for (const [src, name] of FILES) {
  const out = path.join(dir, name)
  if (existsSync(out) && !process.argv.includes('--force')) continue
  const url = `${BASE}/${src.split('/').map(encodeURIComponent).join('/')}`
  try {
    const res = await fetch(url)
    if (!res.ok) throw new Error(`HTTP ${res.status}`)
    const buf = Buffer.from(await res.arrayBuffer())
    writeFileSync(out, buf)
    console.log(`✓ ${name} (${(buf.length / 1024).toFixed(0)} KB)`)
  } catch (err) {
    failed++
    console.error(`✗ ${name}: ${err.message} (${url})`)
  }
}
if (failed) {
  console.error(`\n${failed} file(s) failed. Check your connection and rerun.`)
  process.exit(1)
}
console.log('\nFonts ready in public/fonts')
