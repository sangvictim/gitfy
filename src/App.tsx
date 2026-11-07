import { useEffect } from 'react'
import { AskpassDialog } from './components/AskpassDialog'
import { Toaster } from './components/Toaster'
import { WelcomeScreen } from './features/repo/WelcomeScreen'
import { SettingsPage } from './features/settings/SettingsPage'
import { AppLayout } from './layouts/AppLayout'
import { TabBar } from './layouts/TabBar'
import { useRepoStore } from './store/repo.store'
import { useUiStore } from './store/ui.store'

export default function App() {
  const repo = useRepoStore((s) => s.repo)
  const activeTabId = useRepoStore((s) => s.activeTabId)
  const busy = useRepoStore((s) => s.busy)
  const settingsOpen = useUiStore((s) => s.settingsOpen)

  useEffect(() => {
    // Restore last session's tabs, then let the main process swap the splash for this window
    useRepoStore
      .getState()
      .restoreTabs()
      .finally(() => window.gitfy.app.ready())
  }, [])

  return (
    <div className="flex h-full flex-col">
      <TabBar />
      <div className="min-h-0 flex-1">
        {/* Keyed by tab so each tab mounts fresh views (no stale requests or local UI state leak across tabs) */}
        {settingsOpen ? (
          <SettingsPage />
        ) : repo ? (
          <AppLayout key={activeTabId} />
        ) : (
          <WelcomeScreen key={activeTabId} />
        )}
      </div>
      {!repo && busy && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-black/40">
          <div className="rounded-lg border border-border bg-panel px-5 py-3 shadow-xl">{busy}</div>
        </div>
      )}
      <AskpassDialog />
      <Toaster />
    </div>
  )
}
