import { useState } from 'react'
import { ImagePlus, Palette, Trash2, Type } from 'lucide-react'
import { applyBrandKit, fontFamilyOf, useBrand } from '../../stores/brandStore'
import { useEditor } from '../../stores/editorStore'
import { useUi } from '../../stores/uiStore'
import { CAPTION_FONTS } from '../../lib/captions'
import type { Corner } from '../../types/brand'
import { Button, ColorField, Section, Segmented, Select, Slider, Toggle } from '../../components/ui/controls'

const CORNERS: { value: Corner; label: string }[] = [
  { value: 'tl', label: '↖' },
  { value: 'tr', label: '↗' },
  { value: 'bl', label: '↙' },
  { value: 'br', label: '↘' },
]
const pct = (v: number) => `${Math.round(v * 100)}%`

/** Brand kit editor: saved for all projects; "Apply" pushes it onto the current clips. */
export function BrandKitPanel() {
  const { kit, watermarkSrc, update } = useBrand()
  const toast = useUi((s) => s.toast)
  const clipCount = useEditor((s) => s.data.clips.length)
  const [busy, setBusy] = useState(false)
  const desktop = !!window.clipforge

  const pickWatermark = async () => {
    const file = await window.clipforge?.openFile({ title: 'Choose a watermark / logo', filterName: 'Images', extensions: ['png', 'jpg', 'jpeg', 'webp'] })
    if (!file) return
    try {
      const path = await window.clipforge!.brand.importFile(file)
      await update((k) => ({ ...k, watermark: { enabled: true, path, corner: k.watermark?.corner ?? 'br', size: k.watermark?.size ?? 0.18, opacity: k.watermark?.opacity ?? 0.85 } }))
    } catch (err) {
      toast({ kind: 'error', title: 'Could not use that image', body: err instanceof Error ? err.message : String(err) })
    }
  }

  const addFont = async () => {
    const file = await window.clipforge?.openFile({ title: 'Choose a font file', filterName: 'Fonts', extensions: ['ttf', 'otf'] })
    if (!file) return
    setBusy(true)
    try {
      const path = await window.clipforge!.brand.importFile(file)
      const family = await fontFamilyOf(path)
      await update((k) => ({ ...k, font: { family, path } }))
      toast({ kind: 'success', title: `Font “${family}” added`, body: 'Click “Apply to all clips” to use it.' })
    } catch (err) {
      toast({ kind: 'error', title: 'Could not add the font', body: err instanceof Error ? err.message : String(err) })
    } finally {
      setBusy(false)
    }
  }

  const wm = kit.watermark
  const setWm = (patch: Partial<NonNullable<typeof wm>>) => update((k) => ({ ...k, watermark: k.watermark ? { ...k.watermark, ...patch } : null }))
  const setColor = (key: keyof typeof kit.colors) => (v: string) => update((k) => ({ ...k, colors: { ...k.colors, [key]: v } }))
  const fontOptions = [
    { value: '', label: 'Keep each clip’s font' },
    ...CAPTION_FONTS.map((f) => ({ value: f, label: f })),
    ...(kit.font?.path ? [{ value: kit.font.family, label: `${kit.font.family} (custom)` }] : []),
  ]

  return (
    <div className="rounded-xl border border-line bg-panel-2">
      <div className="flex items-center justify-between px-4 pt-3">
        <span className="flex items-center gap-2 text-[13px] font-semibold"><Palette size={15} className="text-accent" /> Brand kit</span>
        <span className="text-[11px] text-faint">Saved for all projects</span>
      </div>

      <Section title="Watermark">
        {wm ? (
          <>
            <div className="flex items-center gap-3">
              <div className="flex h-12 w-12 items-center justify-center overflow-hidden rounded-md bg-[conic-gradient(#2a2c35_25%,#1c1d23_0_50%,#2a2c35_0_75%,#1c1d23_0)] bg-[length:10px_10px]">
                {watermarkSrc && <img src={watermarkSrc} alt="" className="max-h-full max-w-full" />}
              </div>
              <div className="flex-1"><Toggle label="Show on all clips" checked={wm.enabled} onChange={(enabled) => setWm({ enabled })} /></div>
              <button onClick={() => update((k) => ({ ...k, watermark: null }))} className="text-muted hover:text-bad" aria-label="Remove watermark"><Trash2 size={15} /></button>
            </div>
            <Segmented label="Corner" value={wm.corner} options={CORNERS} onChange={(corner) => setWm({ corner })} />
            <Slider label="Size" value={wm.size} min={0.08} max={0.4} step={0.01} format={pct} onChange={(size) => setWm({ size })} />
            <Slider label="Opacity" value={wm.opacity} min={0.2} max={1} step={0.05} format={pct} onChange={(opacity) => setWm({ opacity })} />
            <Button size="sm" variant="ghost" onClick={pickWatermark}>Replace image…</Button>
          </>
        ) : (
          <Button size="sm" onClick={pickWatermark} disabled={!desktop}><ImagePlus size={14} /> Add watermark / logo</Button>
        )}
      </Section>

      <Section title="Font">
        <Select label="Caption & hook font" value={kit.font?.family ?? ''} options={fontOptions} fontPreview
          onChange={(family) => update((k) => ({ ...k, font: family ? { family, path: k.font?.family === family ? k.font.path : undefined } : null }))} />
        <Button size="sm" variant="ghost" onClick={addFont} disabled={busy || !desktop}><Type size={14} /> {busy ? 'Adding font…' : 'Add font file (.ttf / .otf)…'}</Button>
      </Section>

      <Section title="Colours">
        <ColorField label="Caption text" value={kit.colors.text} onChange={setColor('text')} />
        <ColorField label="Word highlight" value={kit.colors.highlight} onChange={setColor('highlight')} />
        <ColorField label="Outline" value={kit.colors.outline} onChange={setColor('outline')} />
        <ColorField label="Keywords" value={kit.colors.keyword} onChange={setColor('keyword')} />
        <ColorField label="Hook background" value={kit.colors.hookBackground} onChange={setColor('hookBackground')} />
      </Section>

      <div className="p-3">
        <Button className="w-full" variant="primary" size="sm" disabled={!clipCount}
          onClick={() => { applyBrandKit(); toast({ kind: 'success', title: 'Brand kit applied', body: `Font and colours set on ${clipCount} clips. Undo with Ctrl+Z.` }) }}>
          Apply to all clips
        </Button>
        <p className="mt-2 text-[11px] leading-snug text-faint">New clips get the brand kit automatically. The watermark shows on every clip while it’s on.</p>
      </div>
    </div>
  )
}
