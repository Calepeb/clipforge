import { Toggle } from '../../components/ui/controls'
import { useEditor } from '../../stores/editorStore'
import { useUi } from '../../stores/uiStore'

/** Per-clip silence/filler removal switch with what it cut. */
export function TightenToggle() {
  const clipId = useEditor((s) => s.activeClipId)
  const t = useEditor((s) => (s.activeClipId ? s.data.docs[s.activeClipId]?.tightened : null))
  const setTightened = useEditor((s) => s.setTightened)
  const toast = useUi((s) => s.toast)
  if (!clipId) return null

  const toggle = (on: boolean) => {
    const res = setTightened(clipId, on)
    if (on && res && res.removed < 0.05) toast({ kind: 'info', title: 'Nothing to tighten', body: 'No long pauses or filler words found in this clip.' })
  }

  return (
    <div className="flex flex-col gap-1.5">
      <Toggle label="Remove silences & fillers" checked={!!t} onChange={toggle} hint="Cuts “um/uh” and shortens pauses longer than 0.5 s" />
      <p className="text-[11px] leading-snug text-faint">
        {t
          ? `Cut ${t.removed.toFixed(1)} s${t.fillers ? ` · ${t.fillers} filler word${t.fillers === 1 ? '' : 's'}` : ''}. Turning it off restores the cut from before.`
          : 'Shortens pauses over 0.5 s and removes “um”, “uh”. Captions follow the cuts.'}
      </p>
    </div>
  )
}

/** Tighten every clip at once. */
export function useTightenAll() {
  const toast = useUi((s) => s.toast)
  return () => {
    const { data, setTightened } = useEditor.getState()
    let removed = 0
    let fillers = 0
    for (const c of data.clips) {
      const r = setTightened(c.id, true)
      if (r) { removed += r.removed; fillers += r.fillers }
    }
    toast({ kind: 'success', title: `Tightened ${data.clips.length} clips`, body: `Cut ${removed.toFixed(1)} s in total${fillers ? `, ${fillers} filler words` : ''}.` })
  }
}
