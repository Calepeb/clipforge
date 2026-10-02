import { useEffect } from 'react'
import { TopBar } from './features/topbar/TopBar'
import { LeftPanel } from './features/left-panel/LeftPanel'
import { PreviewPanel } from './features/preview/PreviewPanel'
import { PropertiesPanel } from './features/properties/PropertiesPanel'
import { Timeline } from './features/timeline/Timeline'
import { ExportDialog } from './features/export/ExportDialog'
import { HomeScreen } from './features/home/HomeScreen'
import { Toaster } from './components/ui/Toaster'
import { SettingsDialog } from './features/settings/SettingsDialog'
import { runProjectCommand, useShortcuts } from './lib/shortcuts'
import { useProject } from './stores/projectStore'
import { useBrand } from './stores/brandStore'
import { useUpdates } from './stores/updateStore'

export default function App() {
  const view = useProject((s) => s.view)
  useShortcuts()
  useEffect(() => window.clipforge?.onMenuCommand((cmd) => runProjectCommand(cmd)), [])
  useEffect(() => { void useBrand.getState().load() }, [])
  useEffect(() => useUpdates.getState().init(), [])

  return (
    <div className="flex h-full flex-col">
      {view === 'home' ? (
        <HomeScreen />
      ) : (
        <>
          <TopBar />
          <main className="grid min-h-0 flex-1 grid-cols-[minmax(320px,26%)_1fr_minmax(280px,22%)] grid-rows-[minmax(0,1fr)_minmax(250px,34%)] gap-1.5 p-1.5">
            <LeftPanel />
            <PreviewPanel />
            <PropertiesPanel />
            <div className="col-span-3 min-h-0">
              <Timeline />
            </div>
          </main>
          <ExportDialog />
        </>
      )}
      <SettingsDialog />
      <Toaster />
    </div>
  )
}
