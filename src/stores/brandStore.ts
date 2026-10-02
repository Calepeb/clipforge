// Brand kit: watermark, font and colours saved once (in the app data folder) and used by
// every project. Applied to all clips with one click, and automatically to new clips.
import { create } from 'zustand'
import { useEditor } from './editorStore'
import { useUi } from './uiStore'
import { DEFAULT_BRAND, type BrandKit } from '../types/brand'
import { hasBackend } from '../lib/backend'

interface BrandState {
  kit: BrandKit
  loaded: boolean
  /** cf-media URL of the watermark for the preview. */
  watermarkSrc: string | null
  load: () => Promise<void>
  update: (fn: (k: BrandKit) => BrandKit) => Promise<void>
}

const LOCAL_KEY = 'cf.brandkit'

async function registerFont(family: string, path: string) {
  const url = await window.clipforge?.registerMedia(path)
  if (!url) return
  try {
    const face = new FontFace(family, `url("${url}")`)
    await face.load()
    document.fonts.add(face)
  } catch (err) {
    console.error('[brand] could not load font', path, err)
  }
}

export const useBrand = create<BrandState>((set, get) => ({
  kit: DEFAULT_BRAND,
  loaded: false,
  watermarkSrc: null,

  load: async () => {
    let kit: BrandKit | null = null
    try {
      kit = window.clipforge ? await window.clipforge.brand.load() : JSON.parse(localStorage.getItem(LOCAL_KEY) ?? 'null')
    } catch (err) {
      console.error('[brand] load failed', err)
    }
    kit = { ...DEFAULT_BRAND, ...(kit ?? {}), colors: { ...DEFAULT_BRAND.colors, ...(kit?.colors ?? {}) } }
    const watermarkSrc = kit.watermark?.path ? (await window.clipforge?.registerMedia(kit.watermark.path)) ?? null : null
    if (kit.font?.path) await registerFont(kit.font.family, kit.font.path)
    set({ kit, loaded: true, watermarkSrc })
  },

  update: async (fn) => {
    const kit = fn(get().kit)
    const watermarkSrc = kit.watermark?.path && kit.watermark.path !== get().kit.watermark?.path
      ? (await window.clipforge?.registerMedia(kit.watermark.path)) ?? null
      : kit.watermark ? get().watermarkSrc : null
    if (kit.font?.path && kit.font.path !== get().kit.font?.path) await registerFont(kit.font.family, kit.font.path)
    set({ kit, watermarkSrc })
    try {
      if (window.clipforge) await window.clipforge.brand.save(kit)
      else localStorage.setItem(LOCAL_KEY, JSON.stringify(kit))
    } catch (err) {
      useUi.getState().toast({ kind: 'error', title: 'Could not save the brand kit', body: err instanceof Error ? err.message : String(err) })
    }
  },
}))

/** Applies the brand font and colours to the given clips' captions and hook text (undoable). */
export function applyBrandKit(clipIds?: string[]) {
  const { kit } = useBrand.getState()
  const { commit, data } = useEditor.getState()
  const ids = clipIds ?? data.clips.map((c) => c.id)
  commit((d) => {
    for (const id of ids) {
      const style = d.styles[id]
      const doc = d.docs[id]
      if (!style || !doc) continue
      if (kit.font) style.fontFamily = kit.font.family
      style.textColor = kit.colors.text
      style.highlightColor = kit.colors.highlight
      style.outlineColor = kit.colors.outline
      style.keywordColor = kit.colors.keyword
      for (const t of doc.texts) {
        if (kit.font) t.fontFamily = kit.font.family
        if (t.isHook && t.background) t.background = kit.colors.hookBackground
      }
    }
  })
}

/** Reads a font file's family name via the backend (the same name libass matches). */
export async function fontFamilyOf(path: string): Promise<string> {
  if (!hasBackend()) throw new Error('Custom fonts need the desktop app.')
  const info = await window.clipforge!.backendInfo()
  const res = await fetch(`${info.url}/fonts/inspect`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-clipforge-token': info.token },
    body: JSON.stringify({ path }),
  })
  const body = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(body.detail ?? `Font check failed (${res.status})`)
  return body.family
}
