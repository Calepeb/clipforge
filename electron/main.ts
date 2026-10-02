import { app, BrowserWindow, dialog, ipcMain, Menu, shell } from 'electron'
import { writeFile } from 'node:fs/promises'
import path from 'node:path'
import { deleteProject, listProjects, loadProject, projectsDir, saveProject } from './projects'
import { handleMediaProtocol, registerMedia, registerMediaScheme } from './media'
import { backendInfo, restartBackend, startBackend, stopBackend } from './backend'
import { dataDir, hasApiKey, setApiKey } from './settings'
import { setupUpdater } from './updater'
import { importBrandFile, loadBrandKit, saveBrandKit } from './brand'

const isMac = process.platform === 'darwin'

registerMediaScheme()

/** Sends a menu command to the focused window's renderer. */
const send = (cmd: string) => () => BrowserWindow.getFocusedWindow()?.webContents.send('menu:command', cmd)

function buildMenu() {
  // Undo/redo are deliberately left out: the editor handles Ctrl/Cmd+Z itself.
  const template: Electron.MenuItemConstructorOptions[] = [
    ...(isMac ? [{ role: 'appMenu' as const }] : []),
    {
      label: 'File',
      submenu: [
        { label: 'New Project', accelerator: 'CmdOrCtrl+N', click: send('new-project') },
        { label: 'All Projects…', accelerator: 'CmdOrCtrl+O', click: send('open-projects') },
        { type: 'separator' },
        { label: 'Save', accelerator: 'CmdOrCtrl+S', click: send('save') },
        { label: 'Show Projects Folder', click: () => shell.openPath(projectsDir()) },
        ...(isMac ? [] : [{ type: 'separator' as const }, { role: 'quit' as const }]),
      ],
    },
    {
      label: 'Edit',
      submenu: [{ role: 'cut' }, { role: 'copy' }, { role: 'paste' }, { role: 'selectAll' }],
    },
    {
      label: 'View',
      submenu: [
        { role: 'reload' },
        { role: 'toggleDevTools' },
        { type: 'separator' },
        { role: 'togglefullscreen' },
      ],
    },
  ]
  Menu.setApplicationMenu(Menu.buildFromTemplate(template))
}

function registerIpc() {
  ipcMain.handle('projects:list', () => listProjects())
  ipcMain.handle('projects:load', (_e, id: string) => loadProject(id))
  ipcMain.handle('projects:save', (_e, project: unknown) => saveProject(project))
  ipcMain.handle('projects:delete', (_e, id: string) => deleteProject(id))
  ipcMain.handle('projects:open-folder', () => shell.openPath(projectsDir()))
  ipcMain.handle('media:register', (_e, filePath: string) => registerMedia(filePath))
  ipcMain.handle('backend:info', () => backendInfo())
  ipcMain.handle('settings:get', async () => ({ hasApiKey: await hasApiKey(), dataDir: dataDir(), version: app.getVersion(), packaged: app.isPackaged }))
  ipcMain.handle('settings:set-api-key', async (_e, key: string) => {
    await setApiKey(key)
    await restartBackend()
  })
  ipcMain.handle('backend:restart', () => restartBackend())
  ipcMain.handle('shell:open-data-dir', () => shell.openPath(dataDir()))
  ipcMain.handle('brand:load', () => loadBrandKit())
  ipcMain.handle('brand:save', (_e, kit: unknown) => saveBrandKit(kit))
  ipcMain.handle('brand:import-file', (_e, source: string) => importBrandFile(source))
  ipcMain.handle('dialog:open-file', async (e, opts: { title: string; filterName: string; extensions: string[] }) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options = { title: opts.title, properties: ['openFile'] as 'openFile'[], filters: [{ name: opts.filterName, extensions: opts.extensions }] }
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return r.canceled ? null : r.filePaths[0] ?? null
  })
  ipcMain.handle('export:default-dir', () => path.join(app.getPath('videos'), 'ClipForge'))
  ipcMain.handle('dialog:choose-folder', async (e, current?: string) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options = { title: 'Export clips to…', defaultPath: current, properties: ['openDirectory', 'createDirectory'] as ('openDirectory' | 'createDirectory')[] }
    const r = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    return r.canceled ? null : r.filePaths[0] ?? null
  })
  ipcMain.handle('shell:show-item', (_e, filePath: string) => shell.showItemInFolder(filePath))
  ipcMain.handle('shell:open-folder', (_e, dir: string) => shell.openPath(dir))
  ipcMain.handle('dialog:save-text', async (e, opts: { defaultName: string; content: string; filterName: string; extensions: string[] }) => {
    const win = BrowserWindow.fromWebContents(e.sender)
    const options = { defaultPath: path.join(app.getPath('videos'), opts.defaultName), filters: [{ name: opts.filterName, extensions: opts.extensions }] }
    const r = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
    if (r.canceled || !r.filePath) return null
    await writeFile(r.filePath, opts.content, 'utf8')
    return r.filePath
  })
}

function createWindow() {
  const win = new BrowserWindow({
    width: 1600,
    height: 960,
    minWidth: 1180,
    minHeight: 720,
    title: 'ClipForge',
    backgroundColor: '#0d0e12',
    autoHideMenuBar: true,
    show: false,
    webPreferences: {
      preload: path.join(__dirname, 'preload.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: true,
    },
  })

  // CLIPFORGE_HIDE_WINDOW=1 keeps the window hidden (automated end-to-end tests).
  win.once('ready-to-show', () => { if (process.env.CLIPFORGE_HIDE_WINDOW !== '1') win.show() })

  // Before closing, let the renderer flush any pending autosave (max 3s).
  let allowClose = false
  win.on('close', (e) => {
    if (allowClose) return
    e.preventDefault()
    const done = () => {
      allowClose = true
      win.close()
    }
    const timer = setTimeout(done, 3000)
    ipcMain.once('app:flushed', () => {
      clearTimeout(timer)
      done()
    })
    win.webContents.send('app:flush')
  })

  // Open external links in the user's browser, never inside the app.
  win.webContents.setWindowOpenHandler(({ url }) => {
    if (url.startsWith('https://')) shell.openExternal(url)
    return { action: 'deny' }
  })

  if (process.env.VITE_DEV_SERVER_URL) {
    win.loadURL(process.env.VITE_DEV_SERVER_URL)
  } else {
    win.loadFile(path.join(__dirname, '../dist/index.html'))
  }
}

app.whenReady().then(() => {
  handleMediaProtocol()
  registerIpc()
  setupUpdater()
  void startBackend()
  buildMenu()
  createWindow()
  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow()
  })
})

app.on('before-quit', stopBackend)

app.on('window-all-closed', () => {
  if (!isMac) app.quit()
})
