import clsx from 'clsx'
import { Clapperboard, Folder, LayoutTemplate, Music2, Sparkles, Type } from 'lucide-react'
import { useUi, type LeftTab } from '../../stores/uiStore'
import { MediaTab } from '../media/MediaTab'
import { AiClipsTab } from '../ai-clips/AiClipsTab'
import { CaptionsTab } from '../captions/CaptionsTab'
import { AudioTab } from '../audio/AudioTab'
import { EffectsTab } from '../effects/EffectsTab'
import { TemplatesTab } from '../templates/TemplatesTab'

const TABS: { id: LeftTab; label: string; icon: typeof Folder }[] = [
  { id: 'media', label: 'Media', icon: Folder },
  { id: 'clips', label: 'AI Clips', icon: Clapperboard },
  { id: 'captions', label: 'Captions', icon: Type },
  { id: 'audio', label: 'Audio', icon: Music2 },
  { id: 'effects', label: 'Effects', icon: Sparkles },
  { id: 'templates', label: 'Templates', icon: LayoutTemplate },
]

const CONTENT: Record<LeftTab, () => React.JSX.Element> = {
  media: MediaTab,
  clips: AiClipsTab,
  captions: CaptionsTab,
  audio: AudioTab,
  effects: EffectsTab,
  templates: TemplatesTab,
}

export function LeftPanel() {
  const tab = useUi((s) => s.leftTab)
  const setTab = useUi((s) => s.setLeftTab)
  const Content = CONTENT[tab]
  return (
    <div className="flex h-full min-h-0 overflow-hidden rounded-xl border border-line bg-panel">
      <nav className="flex w-[68px] shrink-0 flex-col gap-1 border-r border-line p-1.5">
        {TABS.map(({ id, label, icon: Icon }) => (
          <button
            key={id}
            onClick={() => setTab(id)}
            className={clsx(
              'flex flex-col items-center gap-1 rounded-lg py-2.5 text-[10.5px] font-medium transition-colors',
              tab === id ? 'bg-accent-soft text-accent' : 'text-muted hover:bg-raised hover:text-fg',
            )}
          >
            <Icon size={19} strokeWidth={1.8} />
            {label}
          </button>
        ))}
      </nav>
      <div className="flex min-w-0 flex-1 flex-col">
        <Content />
      </div>
    </div>
  )
}

export function PanelHeader({ title, children }: { title: string; children?: React.ReactNode }) {
  return (
    <div className="flex h-11 shrink-0 items-center justify-between border-b border-line px-4">
      <h2 className="text-[13px] font-semibold">{title}</h2>
      {children}
    </div>
  )
}
