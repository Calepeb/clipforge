import { Redo2, Undo2, Upload } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'
import { Logo } from '../../components/ui/Logo'
import { Button, IconButton, Segmented } from '../../components/ui/controls'
import { useEditor } from '../../stores/editorStore'
import { useUi } from '../../stores/uiStore'
import type { AspectRatio } from '../../types/editor'
import { JobIndicator } from './JobIndicator'
import { ProjectMenu, SaveStatus } from './ProjectMenu'
import { useProject } from '../../stores/projectStore'

const ASPECTS: { value: AspectRatio; label: string }[] = [
  { value: '9:16', label: '9:16' },
  { value: '1:1', label: '1:1' },
  { value: '16:9', label: '16:9' },
]

export function TopBar() {
  const { projectName, setProjectName, aspect, setAspect, undo, redo } = useEditor(
    useShallow((s) => ({ projectName: s.projectName, setProjectName: s.setProjectName, aspect: s.aspect, setAspect: s.setAspect, undo: s.undo, redo: s.redo })),
  )
  const canUndo = useEditor((s) => s.past.length > 0)
  const canRedo = useEditor((s) => s.future.length > 0)
  const selectedCount = useEditor((s) => s.data.clips.filter((c) => c.selected).length)
  const setExportOpen = useUi((s) => s.setExportOpen)
  const goHome = useProject((s) => s.goHome)
  const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl+'

  return (
    <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-panel px-4">
      <button onClick={goHome} title={`All projects (${mod}O)`} className="rounded-lg p-1 transition-opacity hover:opacity-80">
        <Logo />
      </button>
      <ProjectMenu />
      <div className="h-5 w-px bg-line" />
      <input
        value={projectName}
        onChange={(e) => setProjectName(e.target.value)}
        aria-label="Project name"
        placeholder="Untitled project"
        className="w-56 rounded-md bg-transparent px-2 py-1 text-[13px] text-fg outline-none transition-colors hover:bg-raised focus:bg-raised"
      />
      <SaveStatus />
      <div className="flex items-center gap-0.5">
        <IconButton label={`Undo (${mod}Z)`} onClick={undo} disabled={!canUndo}>
          <Undo2 size={16} />
        </IconButton>
        <IconButton label={`Redo (${mod}Shift+Z)`} onClick={redo} disabled={!canRedo}>
          <Redo2 size={16} />
        </IconButton>
      </div>

      <div className="flex-1" />

      <div className="w-44">
        <Segmented value={aspect} options={ASPECTS} onChange={setAspect} />
      </div>
      <JobIndicator />
      <Button variant="primary" onClick={() => setExportOpen(true)} className="px-5">
        <Upload size={15} />
        Export{selectedCount ? ` (${selectedCount})` : ''}
      </Button>
    </header>
  )
}
