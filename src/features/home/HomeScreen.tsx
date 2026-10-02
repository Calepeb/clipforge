import { useEffect, useMemo, useRef, useState } from 'react'
import clsx from 'clsx'
import { Copy, Film, FolderOpen, MoreHorizontal, Pencil, Plus, Search, Settings, Sparkles, Trash2, UploadCloud } from 'lucide-react'
import { useUi } from '../../stores/uiStore'
import { UpdateNotice } from '../settings/UpdatesSection'
import { Logo } from '../../components/ui/Logo'
import { Button, Skeleton } from '../../components/ui/controls'
import { MenuItem } from '../../components/ui/Menu'
import { useProject } from '../../stores/projectStore'
import { storage } from '../../lib/projectStorage'
import { ACCEPTED_VIDEO, importVideoFiles } from '../../lib/importMedia'
import { timeAgo } from '../../lib/time'
import type { ProjectMeta } from '../../types/project'

export function HomeScreen() {
  const { recent, loadingList, refreshList, newProject } = useProject()
  const [query, setQuery] = useState('')
  const [over, setOver] = useState(false)
  const input = useRef<HTMLInputElement>(null)
  const mod = navigator.platform.toLowerCase().includes('mac') ? '⌘' : 'Ctrl+'

  useEffect(() => { refreshList() }, [refreshList])

  const shown = useMemo(() => {
    const q = query.trim().toLowerCase()
    return q ? recent.filter((p) => p.name.toLowerCase().includes(q)) : recent
  }, [recent, query])

  /** New project with these videos already imported. */
  const startWith = async (files: FileList | File[]) => {
    if (![...files].some((f) => ACCEPTED_VIDEO.test(f.name))) return
    await newProject()
    await importVideoFiles(files)
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex h-12 shrink-0 items-center gap-4 border-b border-line bg-panel px-5">
        <Logo />
        <div className="flex-1" />
        <UpdateNotice onOpen={() => useUi.getState().setSettingsOpen(true)} />
        <Button size="sm" variant="ghost" onClick={() => useUi.getState().setSettingsOpen(true)}>
          <Settings size={14} /> Settings
        </Button>
        {storage.openFolder && (
          <Button size="sm" variant="ghost" onClick={storage.openFolder}>
            <FolderOpen size={14} /> Projects folder
          </Button>
        )}
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto">
        <div className="mx-auto flex max-w-6xl flex-col gap-8 px-8 py-8">
          <section className="grid grid-cols-[2fr_1fr] gap-4">
            <div
              role="button"
              tabIndex={0}
              onClick={() => newProject()}
              onKeyDown={(e) => e.key === 'Enter' && newProject()}
              onDragOver={(e) => { e.preventDefault(); setOver(true) }}
              onDragLeave={() => setOver(false)}
              onDrop={(e) => { e.preventDefault(); setOver(false); startWith(e.dataTransfer.files) }}
              className={clsx(
                'group relative flex cursor-pointer items-center gap-5 overflow-hidden rounded-2xl border-2 border-dashed p-7 transition-all',
                over ? 'border-accent bg-accent-soft' : 'border-line-strong bg-panel hover:border-accent/60 hover:bg-panel-2',
              )}
            >
              <div className="flex h-16 w-16 shrink-0 items-center justify-center rounded-2xl bg-gradient-to-br from-accent to-brand-2 shadow-[0_8px_30px_-6px_rgb(255_106_61/0.6)] transition-transform group-hover:scale-105">
                {over ? <UploadCloud size={28} /> : <Plus size={30} strokeWidth={2.2} />}
              </div>
              <div className="flex flex-col gap-1">
                <div className="text-lg font-semibold">New project</div>
                <div className="text-[13px] text-muted">Click to start empty, or drop your videos here to import them right away.</div>
                <div className="mt-1 text-xs text-faint">{mod}N</div>
              </div>
              <button
                onClick={(e) => { e.stopPropagation(); input.current?.click() }}
                className="ml-auto shrink-0 rounded-lg bg-raised px-3 py-2 text-xs font-medium text-fg transition-colors hover:bg-hover"
              >
                Choose videos…
              </button>
              <input
                ref={input}
                type="file"
                accept="video/*"
                multiple
                hidden
                onChange={(e) => { if (e.target.files) startWith(e.target.files); e.target.value = '' }}
              />
            </div>
            <button
              onClick={() => newProject({ sample: true })}
              className="flex items-center gap-4 rounded-2xl border border-line bg-panel p-6 text-left transition-colors hover:border-line-strong hover:bg-panel-2"
            >
              <div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-raised text-track-caption">
                <Sparkles size={22} />
              </div>
              <div>
                <div className="font-semibold">Try the sample</div>
                <div className="text-xs text-muted">A demo project with 8 generated clips.</div>
              </div>
            </button>
          </section>

          <section className="flex flex-col gap-4">
            <div className="flex items-center gap-3">
              <h2 className="text-base font-semibold">Recent projects</h2>
              <span className="text-xs text-faint">{recent.length || ''}</span>
              <div className="flex-1" />
              {recent.length > 0 && (
                <label className="flex h-8 w-64 items-center gap-2 rounded-lg border border-line bg-panel px-2.5 focus-within:border-accent">
                  <Search size={14} className="text-faint" />
                  <input value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Search projects" className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-faint" />
                </label>
              )}
            </div>

            {loadingList && recent.length === 0 ? (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                {Array.from({ length: 4 }, (_, i) => <Skeleton key={i} className="aspect-[4/3]" />)}
              </div>
            ) : recent.length === 0 ? (
              <div className="flex flex-col items-center gap-2 rounded-2xl border border-line bg-panel py-14 text-center">
                <Film size={26} className="text-faint" />
                <div className="text-[13px] text-muted">No projects yet</div>
                <div className="text-xs text-faint">Projects save automatically as you work.</div>
              </div>
            ) : shown.length === 0 ? (
              <div className="py-10 text-center text-[13px] text-faint">No projects match “{query}”.</div>
            ) : (
              <div className="grid grid-cols-[repeat(auto-fill,minmax(220px,1fr))] gap-4">
                {shown.map((p) => <ProjectCard key={p.id} project={p} />)}
              </div>
            )}
          </section>
        </div>
      </div>
    </div>
  )
}

function ProjectCard({ project }: { project: ProjectMeta }) {
  const { openProject, duplicate, rename, remove } = useProject()
  const [menu, setMenu] = useState(false)
  const [renaming, setRenaming] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!menu) return
    const close = (e: MouseEvent) => {
      if (!ref.current?.contains(e.target as Node)) { setMenu(false); setConfirmDelete(false) }
    }
    window.addEventListener('mousedown', close)
    return () => window.removeEventListener('mousedown', close)
  }, [menu])

  return (
    <div ref={ref} className="group relative flex animate-fade-in flex-col gap-2">
      <button
        onClick={() => !renaming && openProject(project.id)}
        className="relative aspect-video overflow-hidden rounded-xl border border-line bg-panel transition-all group-hover:border-line-strong group-hover:shadow-[0_10px_30px_-10px_rgb(0_0_0/0.7)]"
      >
        {project.thumbnail ? (
          <img src={project.thumbnail} alt="" className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.03]" />
        ) : (
          <div className="flex h-full w-full items-center justify-center bg-[radial-gradient(circle_at_30%_20%,#2b2733,#15161b)]">
            <Film size={28} className="text-faint" />
          </div>
        )}
        {project.clipCount > 0 && (
          <span className="absolute bottom-2 left-2 rounded-md bg-black/70 px-1.5 py-0.5 text-[11px] font-medium">{project.clipCount} clips</span>
        )}
      </button>

      <div className="flex items-start gap-1">
        <div className="min-w-0 flex-1">
          {renaming ? (
            <input
              autoFocus
              defaultValue={project.name}
              onFocus={(e) => e.target.select()}
              onBlur={(e) => { rename(project.id, e.target.value); setRenaming(false) }}
              onKeyDown={(e) => {
                if (e.key === 'Enter') e.currentTarget.blur()
                if (e.key === 'Escape') { e.currentTarget.value = project.name; e.currentTarget.blur() }
              }}
              className="h-7 w-full rounded-md border border-accent bg-app px-2 text-[13px] outline-none"
            />
          ) : (
            <div className="truncate text-[13px] font-medium" title={project.name} onDoubleClick={() => setRenaming(true)}>{project.name}</div>
          )}
          <div className="text-xs text-faint">
            Edited {timeAgo(project.updatedAt)} · {project.mediaCount} video{project.mediaCount === 1 ? '' : 's'}
          </div>
        </div>
        <button
          onClick={() => setMenu(!menu)}
          aria-label="Project actions"
          className={clsx('flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition-all hover:bg-raised hover:text-fg', menu ? 'opacity-100' : 'opacity-0 group-hover:opacity-100')}
        >
          <MoreHorizontal size={16} />
        </button>
      </div>

      {menu && (
        <div className="absolute right-0 top-[calc(100%-8px)] z-20 w-44 animate-fade-in rounded-xl border border-line-strong bg-panel-2 p-1 shadow-2xl">
          {confirmDelete ? (
            <div className="flex flex-col gap-2 p-2">
              <div className="text-xs text-muted">Delete “{project.name}”?</div>
              <div className="flex gap-1.5">
                <Button size="sm" className="flex-1" onClick={() => { setMenu(false); setConfirmDelete(false) }}>Cancel</Button>
                <Button size="sm" className="flex-1 !bg-bad !text-black" onClick={() => { setMenu(false); remove(project.id) }}>Delete</Button>
              </div>
            </div>
          ) : (
            <>
              <MenuItem icon={<Pencil size={14} />} onClick={() => { setMenu(false); setRenaming(true) }}>Rename</MenuItem>
              <MenuItem icon={<Copy size={14} />} onClick={() => { setMenu(false); duplicate(project.id) }}>Duplicate</MenuItem>
              <MenuItem icon={<Trash2 size={14} />} danger onClick={() => setConfirmDelete(true)}>Delete…</MenuItem>
            </>
          )}
        </div>
      )}
    </div>
  )
}
