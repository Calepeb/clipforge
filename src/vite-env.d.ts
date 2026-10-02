/// <reference types="vite/client" />

type UpdateStatus =
  | { state: 'disabled'; reason: string }
  | { state: 'idle' | 'checking' | 'not-available'; version: string; checkedAt?: number }
  | { state: 'available'; version: string; newVersion: string; notes?: string }
  | { state: 'downloading'; version: string; newVersion: string; percent: number }
  | { state: 'downloaded'; version: string; newVersion: string }
  | { state: 'error'; version: string; message: string }

interface Window {
  /** Exposed by electron/preload.ts; undefined when running `npm run dev:web`. */
  clipforge?: {
    platform: string
    getPathForFile: (file: File) => string
    registerMedia: (filePath: string) => Promise<string | null>
    exportDefaultDir: () => Promise<string>
    updates: {
      status: () => Promise<UpdateStatus>
      check: () => Promise<UpdateStatus>
      download: () => Promise<UpdateStatus>
      install: () => Promise<void>
      onStatus: (cb: (s: UpdateStatus) => void) => () => void
    }
    settings: {
      get: () => Promise<{ hasApiKey: boolean; dataDir: string; version: string; packaged: boolean }>
      setApiKey: (key: string) => Promise<void>
      restartBackend: () => Promise<void>
      openDataDir: () => Promise<string>
    }
    brand: {
      load: () => Promise<import('./types/brand').BrandKit | null>
      save: (kit: import('./types/brand').BrandKit) => Promise<void>
      importFile: (source: string) => Promise<string>
    }
    openFile: (opts: { title: string; filterName: string; extensions: string[] }) => Promise<string | null>
    chooseFolder: (current?: string) => Promise<string | null>
    showItem: (filePath: string) => Promise<void>
    openFolder: (dir: string) => Promise<string>
    /** Native Save dialog; resolves to the saved path or null if cancelled. */
    saveText: (opts: { defaultName: string; content: string; filterName: string; extensions: string[] }) => Promise<string | null>
    backendInfo: () => Promise<{ status: 'starting' | 'ready' | 'unavailable' | 'crashed'; url: string | null; token: string; error: string | null }>
    projects: {
      list: () => Promise<import('./types/project').ProjectMeta[]>
      load: (id: string) => Promise<import('./types/project').ProjectFile>
      save: (project: import('./types/project').ProjectFile) => Promise<void>
      remove: (id: string) => Promise<void>
      openFolder: () => Promise<string>
    }
    onMenuCommand: (cb: (cmd: string) => void) => () => void
    onFlushRequest: (cb: () => Promise<void>) => void
  }
}
