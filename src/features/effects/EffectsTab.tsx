import type { ReactNode } from 'react'
import clsx from 'clsx'
import { BarChart3, Palette, Scissors, Sparkles, Sun, Volume2, ZoomIn } from 'lucide-react'
import { useActiveDoc, useEditor } from '../../stores/editorStore'
import { useUi } from '../../stores/uiStore'
import { COLOR_PRESETS, DEFAULT_EFFECTS, effectsOf } from '../../lib/effects'
import type { ClipEffects } from '../../types/editor'
import { Button, Segmented, Slider, Toggle } from '../../components/ui/controls'
import { PanelHeader } from '../left-panel/LeftPanel'
import { TightenToggle, useTightenAll } from './TightenToggle'

const pct = (v: number) => `${Math.round(v * 100)}%`
const secs = (v: number) => (v ? `${v.toFixed(1)} s` : 'Off')

function Card({ icon, title, children }: { icon: ReactNode; title: string; children: ReactNode }) {
  return (
    <div className="flex flex-col gap-3 rounded-lg border border-line bg-panel-2 p-3">
      <div className="flex items-center gap-2 text-xs font-semibold uppercase tracking-wide text-muted">{icon} {title}</div>
      {children}
    </div>
  )
}

export function EffectsTab() {
  const doc = useActiveDoc()
  const commit = useEditor((s) => s.commit)
  const clipId = useEditor((s) => s.activeClipId)
  const clipCount = useEditor((s) => s.data.clips.length)
  const toast = useUi((s) => s.toast)
  const tightenAll = useTightenAll()

  if (!doc || !clipId) {
    return (
      <>
        <PanelHeader title="Effects" />
        <div className="p-4 text-xs text-faint">Open a clip to use effects.</div>
      </>
    )
  }

  const fx = effectsOf(doc)
  /** Change this clip's effects; slider drags (same key) are one undo step. */
  const set = (fn: (e: ClipEffects) => ClipEffects, key?: string) =>
    commit((d) => { d.docs[clipId].effects = fn(effectsOf(d.docs[clipId] as typeof doc)) }, key)
  const setColor = (patch: Partial<ClipEffects['color']>, key?: string) => set((e) => ({ ...e, color: { ...e.color, ...patch, preset: 'custom' } }), key)

  const applyAll = () => {
    commit((d) => { for (const id of Object.keys(d.docs)) d.docs[id].effects = structuredClone(fx) })
    toast({ kind: 'success', title: `Effects applied to ${clipCount} clips`, body: 'Undo with Ctrl+Z.' })
  }

  return (
    <>
      <PanelHeader title="Effects">
        {JSON.stringify(fx) !== JSON.stringify(DEFAULT_EFFECTS) && (
          <button onClick={() => set(() => structuredClone(DEFAULT_EFFECTS))} className="text-xs text-muted hover:text-fg">Reset</button>
        )}
      </PanelHeader>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <Card icon={<ZoomIn size={14} />} title="Auto zoom">
          <Toggle label="Punch-in zooms" checked={fx.zoom.enabled} onChange={(enabled) => set((e) => ({ ...e, zoom: { ...e.zoom, enabled } }))}
            hint="Quick zoom cuts keep viewers' attention — the classic short-form edit" />
          {fx.zoom.enabled && (
            <>
              <Segmented
                label="Zoom on"
                value={fx.zoom.trigger}
                options={[{ value: 'sentence', label: 'Sentences' }, { value: 'keyword', label: 'Keywords' }, { value: 'interval', label: 'Timer' }]}
                onChange={(trigger) => set((e) => ({ ...e, zoom: { ...e.zoom, trigger } }))}
              />
              {fx.zoom.trigger === 'interval' && (
                <Slider label="Every" value={fx.zoom.interval} min={1.5} max={8} step={0.5} unit=" s" onChange={(interval) => set((e) => ({ ...e, zoom: { ...e.zoom, interval } }), 'fx-zint')} />
              )}
              <Slider label="Zoom amount" value={fx.zoom.amount} min={1.05} max={1.4} step={0.01} format={(v) => `${v.toFixed(2)}×`} onChange={(amount) => set((e) => ({ ...e, zoom: { ...e.zoom, amount } }), 'fx-zamt')} />
              <p className="-mt-1 text-[11px] leading-snug text-faint">
                {fx.zoom.trigger === 'sentence' ? 'Every other sentence is punched in, cutting on its first word.' : fx.zoom.trigger === 'keyword' ? 'Zooms in on attention-grabbing words like “never”, “secret”, “million”.' : 'Alternates between normal and zoomed on a fixed beat.'}
              </p>
            </>
          )}
        </Card>

        <Card icon={<Palette size={14} />} title="Colour">
          <div className="grid grid-cols-4 gap-1.5">
            {COLOR_PRESETS.map((p) => (
              <button
                key={p.id}
                onClick={() => set((e) => ({ ...e, color: { ...p.color, preset: p.id }, vignette: p.vignette ?? (p.id === 'none' ? 0 : e.vignette) }))}
                className={clsx(
                  'rounded-md border px-1 py-1.5 text-[11px] transition-colors',
                  fx.color.preset === p.id ? 'border-accent bg-accent-soft text-fg' : 'border-line text-muted hover:border-line-strong hover:text-fg',
                )}
              >
                {p.name}
              </button>
            ))}
          </div>
          <Slider label="Brightness" value={fx.color.brightness} min={-0.3} max={0.3} step={0.01} format={(v) => `${v > 0 ? '+' : ''}${Math.round(v * 100)}`} onChange={(brightness) => setColor({ brightness }, 'fx-b')} />
          <Slider label="Contrast" value={fx.color.contrast} min={0.5} max={1.6} step={0.01} format={pct} onChange={(contrast) => setColor({ contrast }, 'fx-c')} />
          <Slider label="Saturation" value={fx.color.saturation} min={0} max={2} step={0.01} format={pct} onChange={(saturation) => setColor({ saturation }, 'fx-s')} />
          <Slider label="Warmth" value={fx.color.warmth} min={-1} max={1} step={0.01} format={(v) => (v === 0 ? '0' : v > 0 ? `warm ${Math.round(v * 100)}` : `cool ${Math.round(-v * 100)}`)} onChange={(warmth) => setColor({ warmth }, 'fx-w')} />
        </Card>

        <Card icon={<Sun size={14} />} title="Vignette & fades">
          <Slider label="Vignette" value={fx.vignette} min={0} max={0.8} step={0.01} format={(v) => (v ? pct(v) : 'Off')} onChange={(vignette) => set((e) => ({ ...e, vignette }), 'fx-v')} />
          <Slider label="Fade in from black" value={fx.fadeIn} min={0} max={2} step={0.1} format={secs} onChange={(fadeIn) => set((e) => ({ ...e, fadeIn }), 'fx-fi')} />
          <Slider label="Fade out to black" value={fx.fadeOut} min={0} max={2} step={0.1} format={secs} onChange={(fadeOut) => set((e) => ({ ...e, fadeOut }), 'fx-fo')} />
        </Card>

        <Card icon={<Volume2 size={14} />} title="Audio">
          <Toggle label="Normalize loudness" checked={fx.normalizeAudio} onChange={(normalizeAudio) => set((e) => ({ ...e, normalizeAudio }))}
            hint="−14 LUFS, the level TikTok, Reels and Shorts play at" />
          <p className="-mt-1 text-[11px] leading-snug text-faint">Evens out the volume to −14 LUFS, the level short-form apps play at. Applied when you export.</p>
        </Card>

        <Card icon={<Scissors size={14} />} title="Cleanup">
          <TightenToggle />
          {clipCount > 1 && <Button size="sm" onClick={tightenAll}>Tighten all {clipCount} clips</Button>}
        </Card>

        <Card icon={<BarChart3 size={14} />} title="Overlays">
          <Toggle label="Progress bar" checked={doc.progressBar} onChange={(v) => commit((d) => { d.docs[clipId].progressBar = v })} />
          <p className="text-[11px] leading-snug text-faint">Watermark and brand colours live in Templates → Brand kit. Music is in the Audio tab.</p>
        </Card>

        {clipCount > 1 && (
          <Button size="sm" variant="primary" onClick={applyAll}><Sparkles size={14} /> Apply these effects to all clips</Button>
        )}
      </div>
    </>
  )
}
