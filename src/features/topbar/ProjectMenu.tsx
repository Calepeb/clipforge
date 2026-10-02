import { useEffect, useRef, useState } from 'react'
import clsx from 'clsx'
import { AlertCircle, Check, ChevronDown, Copy, FolderOpen, LayoutGrid, Loader2, Plus, Save, Settings } from 'lucide-react'
import { useUi } from '../../stores/uiStore'
import { MenuItem } from '../../components/ui/Menu'
import { useProject } from '../../stores/projectStore'
import { storage } from '../../lib/projectStorage'
import { timeAgo } from '../../lib/time'

const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl+'

export function ProjectMenu() {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const { newProject, goHome, save, duplicate, projectId } = useProject()

  useEffect(() => {
    if (!open) return
    const close = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [open])

  const run = (fn: () => unknown) => () => { setOpen(false); fn() }

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={clsx('flex h-8 items-center gap-1 rounded-lg px-2.5 text-[13px] font-medium transition-colors', open ? 'bg-raised text-fg' : 'text-muted hover:bg-raised hover:text-fg')}
      >
        File <ChevronDown size={14} />
      </button>
      {open && (
        <div className="absolute left-0 top-10 z-40 w-60 animate-fade-in rounded-xl border border-line-strong bg-panel-2 p-1 shadow-2xl">
          <MenuItem icon={<Plus size={14} />} shortcut={`${mod}N`} onClick={run(() => newProject())}>New project</MenuItem>
          <MenuItem icon={<LayoutGrid size={14} />} shortcut={`${mod}O`} onClick={run(goHome)}>All projects</MenuItem>
          <div className="my-1 h-px bg-line" />
          <MenuItem icon={<Save size={14} />} shortcut={`${mod}S`} onClick={run(save)}>Save now</MenuItem>
          <MenuItem icon={<Copy size={14} />} onClick={run(async () => { await save(); if (projectId) await duplicate(projectId) })}>Duplicate project</MenuItem>
          {storage.openFolder && <MenuItem icon={<FolderOpen size={14} />} onClick={run(storage.openFolder)}>Show projects folder</MenuItem>}
          <div className="my-1 h-px bg-line" />
          <MenuItem icon={<Settings size={14} />} onClick={run(() => useUi.getState().setSettingsOpen(true))}>Settings…</MenuItem>
        </div>
      )}
    </div>
  )
}

/** Small autosave indicator next to the project name. Click to save now / retry. */
export function SaveStatus() {
  const status = useProject((s) => s.status)
  const lastSavedAt = useProject((s) => s.lastSavedAt)
  const error = useProject((s) => s.error)
  const save = useProject((s) => s.save)
  const [, tick] = useState(0)

  // Keep "saved 2 min ago" fresh.
  useEffect(() => {
    const t = setInterval(() => tick((n) => n + 1), 30_000)
    return () => clearInterval(t)
  }, [])

  const view = {
    saved: { icon: <Check size={13} />, text: 'Saved', cls: 'text-faint', title: lastSavedAt ? `Saved ${timeAgo(lastSavedAt)}` : 'Saved' },
    dirty: { icon: <span className="h-1.5 w-1.5 rounded-full bg-warn" />, text: 'Unsaved', cls: 'text-muted', title: 'Autosaves in a moment. Click to save now.' },
    saving: { icon: <Loader2 size={13} className="animate-spin" />, text: 'Saving…', cls: 'text-muted', title: 'Saving' },
    error: { icon: <AlertCircle size={13} />, text: 'Save failed', cls: 'text-bad', title: `${error ?? 'Save failed'}. Click to retry.` },
  }[status]

  return (
    <button onClick={() => save()} title={view.title} className={clsx('flex h-7 items-center gap-1.5 rounded-md px-2 text-xs transition-colors hover:bg-raised', view.cls)}>
      {view.icon}
      {view.text}
    </button>
  )
}
