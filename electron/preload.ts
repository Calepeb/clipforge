import { contextBridge, ipcRenderer, webUtils } from 'electron'

// Minimal, explicit bridge. Grows in Phase 2 (backend port/token handshake).
contextBridge.exposeInMainWorld('clipforge', {
  platform: process.platform,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
  registerMedia: (filePath: string) => ipcRenderer.invoke('media:register', filePath),
  backendInfo: () => ipcRenderer.invoke('backend:info'),
  exportDefaultDir: () => ipcRenderer.invoke('export:default-dir'),
  updates: {
    status: () => ipcRenderer.invoke('update:status'),
    check: () => ipcRenderer.invoke('update:check'),
    download: () => ipcRenderer.invoke('update:download'),
    install: () => ipcRenderer.invoke('update:install'),
    onStatus: (cb: (s: unknown) => void) => {
      const handler = (_e: unknown, s: unknown) => cb(s)
      ipcRenderer.on('update:status', handler)
      return () => ipcRenderer.removeListener('update:status', handler)
    },
  },
  settings: {
    get: () => ipcRenderer.invoke('settings:get'),
    setApiKey: (key: string) => ipcRenderer.invoke('settings:set-api-key', key),
    restartBackend: () => ipcRenderer.invoke('backend:restart'),
    openDataDir: () => ipcRenderer.invoke('shell:open-data-dir'),
  },
  brand: {
    load: () => ipcRenderer.invoke('brand:load'),
    save: (kit: unknown) => ipcRenderer.invoke('brand:save', kit),
    importFile: (source: string) => ipcRenderer.invoke('brand:import-file', source),
  },
  openFile: (opts: { title: string; filterName: string; extensions: string[] }) => ipcRenderer.invoke('dialog:open-file', opts),
  chooseFolder: (current?: string) => ipcRenderer.invoke('dialog:choose-folder', current),
  showItem: (filePath: string) => ipcRenderer.invoke('shell:show-item', filePath),
  openFolder: (dir: string) => ipcRenderer.invoke('shell:open-folder', dir),
  saveText: (opts: { defaultName: string; content: string; filterName: string; extensions: string[] }) => ipcRenderer.invoke('dialog:save-text', opts),
  projects: {
    list: () => ipcRenderer.invoke('projects:list'),
    load: (id: string) => ipcRenderer.invoke('projects:load', id),
    save: (project: unknown) => ipcRenderer.invoke('projects:save', project),
    remove: (id: string) => ipcRenderer.invoke('projects:delete', id),
    openFolder: () => ipcRenderer.invoke('projects:open-folder'),
  },
  onMenuCommand: (cb: (cmd: string) => void) => {
    const handler = (_e: unknown, cmd: string) => cb(cmd)
    ipcRenderer.on('menu:command', handler)
    return () => ipcRenderer.removeListener('menu:command', handler)
  },
  /** Main asks us to save before the window closes; we always reply, even on failure. */
  onFlushRequest: (cb: () => Promise<void>) => {
    ipcRenderer.on('app:flush', async () => {
      try {
        await cb()
      } finally {
        ipcRenderer.send('app:flushed')
      }
    })
  },
})
