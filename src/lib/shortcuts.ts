import { useEffect } from 'react'
import { docDuration, useEditor } from '../stores/editorStore'
import { useUi } from '../stores/uiStore'
import { useProject } from '../stores/projectStore'
import { FPS } from './time'

function isTyping(el: EventTarget | null) {
  const t = el as HTMLElement | null
  return !!t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT' || t.isContentEditable)
}

/**
 * Global shortcuts. Project: Ctrl/Cmd+S save · Ctrl/Cmd+N new · Ctrl/Cmd+O all projects.
 * Editor:
 * Space play/pause · S split · M merge · Delete ripple-delete (Shift+Delete keeps the gap) · Ctrl/Cmd+Z undo ·
 * Ctrl/Cmd+Shift+Z or Ctrl+Y redo · ←/→ frame step (Shift = 1s) · +/- zoom · Esc deselect
 */
export function useShortcuts() {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Project commands work everywhere, even while typing. (In the desktop app the
      // File menu accelerators handle these first and the keydown never arrives.)
      if ((e.ctrlKey || e.metaKey) && !e.shiftKey && !e.altKey && runProjectCommand(e.key.toLowerCase())) {
        e.preventDefault()
        return
      }
      if (useProject.getState().view !== 'editor') return
      if (isTyping(e.target) || useUi.getState().exportOpen) return
      const st = useEditor.getState()
      const mod = e.ctrlKey || e.metaKey
      const key = e.key.toLowerCase()

      if (mod && key === 'z') { e.preventDefault(); if (e.shiftKey) st.redo(); else st.undo(); return }
      if (mod && key === 'y') { e.preventDefault(); st.redo(); return }
      if (mod) return

      switch (e.key) {
        case ' ': {
          e.preventDefault()
          const dur = docDuration(st.activeClipId ? st.data.docs[st.activeClipId] : undefined)
          if (!st.playing && st.time >= dur - 0.05) st.seek(0)
          st.setPlaying(!st.playing)
          break
        }
        case 's':
        case 'S':
          e.preventDefault()
          st.splitAtPlayhead()
          break
        case 'Delete':
        case 'Backspace':
          e.preventDefault()
          st.deleteSelection({ ripple: !e.shiftKey })
          break
        case 'm':
        case 'M':
          if (st.selection?.kind === 'video') {
            e.preventDefault()
            if (!st.mergeWithNext(st.selection.id)) {
              useUi.getState().toast({ kind: 'info', title: 'Can’t merge', body: 'Merge joins a segment with the next one when they continue each other in the source (e.g. after a split).' })
            }
          }
          break
        case 'ArrowLeft':
        case 'ArrowRight': {
          e.preventDefault()
          const step = e.shiftKey ? 1 : 1 / FPS
          st.setPlaying(false)
          st.seek(st.time + (e.key === 'ArrowLeft' ? -step : step))
          break
        }
        case '=':
        case '+':
          st.setPxPerSec(st.pxPerSec * 1.25)
          break
        case '-':
          st.setPxPerSec(st.pxPerSec / 1.25)
          break
        case 'Escape':
          st.select(null)
          break
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])
}

const PROJECT_KEYS: Record<string, string> = { s: 'save', n: 'new-project', o: 'open-projects' }

/** Runs a project command by shortcut key or menu command name. Returns true if handled. */
export function runProjectCommand(keyOrCmd: string): boolean {
  const cmd = PROJECT_KEYS[keyOrCmd] ?? keyOrCmd
  const p = useProject.getState()
  if (cmd === 'save') { if (p.view === 'editor') p.save(); return true }
  if (cmd === 'new-project') { p.newProject(); return true }
  if (cmd === 'open-projects') { p.goHome(); return true }
  return false
}
