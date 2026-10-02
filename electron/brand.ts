// Brand kit: saved once, used by every project. Lives in <userData>/brand/ with copies of
// the watermark image and any custom font files, so moving the originals breaks nothing.
import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'

export const brandDir = () => path.join(app.getPath('userData'), 'brand')
const kitFile = () => path.join(brandDir(), 'brandkit.json')

export async function loadBrandKit(): Promise<unknown | null> {
  try {
    return JSON.parse(await fs.readFile(kitFile(), 'utf8'))
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code !== 'ENOENT') console.error('[brand] unreadable brand kit:', err)
    return null
  }
}

export async function saveBrandKit(kit: unknown): Promise<void> {
  await fs.mkdir(brandDir(), { recursive: true })
  const tmp = `${kitFile()}.tmp`
  await fs.writeFile(tmp, JSON.stringify(kit, null, 2), 'utf8')
  await fs.rename(tmp, kitFile())
}

const ALLOWED = new Set(['.png', '.jpg', '.jpeg', '.webp', '.ttf', '.otf'])

/** Copy a watermark image or font into the brand folder; returns the new path. */
export async function importBrandFile(source: string): Promise<string> {
  const ext = path.extname(source).toLowerCase()
  if (!ALLOWED.has(ext)) throw new Error('Use a PNG/JPG/WebP image or a TTF/OTF font.')
  await fs.mkdir(brandDir(), { recursive: true })
  const base = path.basename(source, ext).replace(/[^\w.-]+/g, '_').slice(0, 60) || 'brand'
  let target = path.join(brandDir(), base + ext)
  for (let n = 2; await fs.stat(target).then(() => true, () => false); n++) target = path.join(brandDir(), `${base}-${n}${ext}`)
  await fs.copyFile(source, target)
  return target
}
