import { useEditor } from '../../stores/editorStore'
import { useUi } from '../../stores/uiStore'
import { CAPTION_PRESETS } from '../../lib/captions'
import { PanelHeader } from '../left-panel/LeftPanel'
import { BrandKitPanel } from './BrandKitPanel'

/** A template = caption preset + hook overlay colour + progress bar setting. */
const TEMPLATES = [
  { id: 'podcast', name: 'Podcast Highlight', preset: 'spotlight', hookBg: '#e2366f', progress: true, gradient: 'from-[#e2366f] to-[#ff8a4c]' },
  { id: 'story', name: 'Storytime', preset: 'type', hookBg: '#1d1e24', progress: false, gradient: 'from-[#3b3f8f] to-[#9b7bff]' },
  { id: 'hype', name: 'Hype Reel', preset: 'punch', hookBg: '#ff6a3d', progress: true, gradient: 'from-[#ff6a3d] to-[#ffd23f]' },
  { id: 'edu', name: 'Explainer', preset: 'keyword', hookBg: '#0f8f6a', progress: true, gradient: 'from-[#0f8f6a] to-[#7cd4ff]' },
]

export function TemplatesTab() {
  const commit = useEditor((s) => s.commit)
  const toast = useUi((s) => s.toast)

  const apply = (t: (typeof TEMPLATES)[number]) => {
    const style = CAPTION_PRESETS.find((p) => p.id === t.preset)!.style
    commit((d) => {
      for (const id of Object.keys(d.docs)) {
        d.styles[id] = { ...style }
        d.docs[id].progressBar = t.progress
        d.docs[id].texts.filter((x) => x.isHook).forEach((x) => { x.background = t.hookBg })
      }
    })
    toast({ kind: 'success', title: `Template “${t.name}” applied`, body: 'Applied to every clip. Undo with Ctrl+Z.' })
  }

  return (
    <>
      <PanelHeader title="Templates" />
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        <BrandKitPanel />
        <div className="px-1 text-xs font-semibold uppercase tracking-wide text-muted">Templates</div>
        <div className="grid auto-rows-min grid-cols-2 gap-2.5">
        {TEMPLATES.map((t) => (
          <button key={t.id} onClick={() => apply(t)} className="group flex flex-col gap-1.5 text-left">
            <div className={`relative aspect-[9/16] overflow-hidden rounded-lg border-2 border-transparent bg-gradient-to-br ${t.gradient} transition-all group-hover:border-white/40`}>
              <div className="absolute left-2 right-2 top-4 rounded px-1 py-0.5 text-center text-[9px] font-bold" style={{ background: t.hookBg }}>HOOK TEXT</div>
              <div className="absolute bottom-10 left-0 right-0 text-center text-[11px] font-black text-white [paint-order:stroke_fill] [-webkit-text-stroke:3px_#000]">CAPTIONS HERE</div>
              {t.progress && <div className="absolute bottom-0 left-0 h-1 w-2/3 bg-white" />}
            </div>
            <span className="text-xs text-muted group-hover:text-fg">{t.name}</span>
          </button>
        ))}
        </div>
      </div>
    </>
  )
}
