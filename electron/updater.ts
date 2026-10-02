// Auto-updates via electron-updater + GitHub Releases (see "publish" in electron-builder.yml).
// Checks shortly after launch and every 6 hours; downloads only when the user clicks
// "Download", then "Restart to update" installs it (projects are saved before quitting).
import { app, BrowserWindow, ipcMain } from 'electron'
import { readFileSync } from 'node:fs'
import path from 'node:path'
import electronUpdater from 'electron-updater'

const { autoUpdater } = electronUpdater

export type UpdateState =
  | { state: 'disabled'; reason: string }
  | { state: 'idle' | 'checking' | 'not-available'; version: string; checkedAt?: number }
  | { state: 'available'; version: string; newVersion: string; notes?: string }
  | { state: 'downloading'; version: string; newVersion: string; percent: number }
  | { state: 'downloaded'; version: string; newVersion: string }
  | { state: 'error'; version: string; message: string }

let status: UpdateState = { state: 'idle', version: app.getVersion() }

function broadcast(next: UpdateState) {
  status = next
  for (const w of BrowserWindow.getAllWindows()) w.webContents.send('update:status', status)
}

/** Why updates can't work in this build, if they can't. */
function disabledReason(): string | null {
  if (!app.isPackaged) return 'Updates work in the installed app, not in development.'
  if (process.platform === 'darwin') return 'Automatic updates on Mac need an Apple-signed app. Download new versions from the GitHub releases page.'
  try {
    const cfg = readFileSync(path.join(process.resourcesPath, 'app-update.yml'), 'utf8')
    if (cfg.includes('YOUR_GITHUB_USERNAME')) return 'Updates aren’t set up yet: add your GitHub username/repo under “publish” in electron-builder.yml and rebuild.'
  } catch {
    return 'This build has no update settings (publish config missing when it was built).'
  }
  return null
}

const errorMessage = (err: unknown) => {
  const msg = err instanceof Error ? err.message : String(err)
  if (/404|HttpError: 404/.test(msg)) return 'No releases found on the update server yet.'
  if (/ENOTFOUND|ETIMEDOUT|ECONNREFUSED|net::/.test(msg)) return 'Couldn’t reach the update server (offline?).'
  return msg.split('\n')[0]
}

export function setupUpdater() {
  ipcMain.handle('update:status', () => status)
  const reason = disabledReason()
  if (reason) {
    status = { state: 'disabled', reason }
    ipcMain.handle('update:check', () => status)
    ipcMain.handle('update:download', () => status)
    ipcMain.handle('update:install', () => status)
    return
  }

  autoUpdater.autoDownload = false
  autoUpdater.autoInstallOnAppQuit = true
  const version = app.getVersion()

  autoUpdater.on('checking-for-update', () => broadcast({ state: 'checking', version }))
  autoUpdater.on('update-not-available', () => broadcast({ state: 'not-available', version, checkedAt: Date.now() }))
  autoUpdater.on('update-available', (info) =>
    broadcast({ state: 'available', version, newVersion: info.version, notes: typeof info.releaseNotes === 'string' ? info.releaseNotes : undefined }),
  )
  autoUpdater.on('download-progress', (p) =>
    broadcast({ state: 'downloading', version, newVersion: status.state === 'available' || status.state === 'downloading' ? status.newVersion : '', percent: p.percent }),
  )
  autoUpdater.on('update-downloaded', (info) => broadcast({ state: 'downloaded', version, newVersion: info.version }))
  autoUpdater.on('error', (err) => {
    console.error('[updater]', err)
    broadcast({ state: 'error', version, message: errorMessage(err) })
  })

  const check = () => autoUpdater.checkForUpdates().catch(() => undefined) // errors arrive via 'error'
  ipcMain.handle('update:check', async () => {
    await check()
    return status
  })
  ipcMain.handle('update:download', async () => {
    await autoUpdater.downloadUpdate().catch(() => undefined)
    return status
  })
  // Closing windows triggers the autosave flush before the installer runs.
  ipcMain.handle('update:install', () => autoUpdater.quitAndInstall(false, true))

  setTimeout(check, 10_000)
  setInterval(check, 6 * 60 * 60 * 1000)
}
