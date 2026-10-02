import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import './index.css'
import { useEditor } from './stores/editorStore'
import { useProject } from './stores/projectStore'
import { useExport } from './stores/exportStore'

// Handy for debugging in DevTools during development.
if (import.meta.env.DEV) Object.assign(window, { __cf: { useEditor, useProject, useExport } })

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
