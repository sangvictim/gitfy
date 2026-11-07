import { useEffect } from 'react'
import { RefsSidebar } from '../features/branch/RefsSidebar'
import { CommitPanel } from '../features/commit/CommitPanel'
import { GraphView } from '../features/commit/GraphView'
import { DiffPanel } from '../features/diff/DiffPanel'
import { WipPanel } from '../features/staging/WipPanel'
import { useRepoStore } from '../store/repo.store'
import { Header } from './Header'

const STATUS_POLL_MS = 3000

export function AppLayout() {
  const selected = useRepoStore((s) => s.selected)
  const openDiff = useRepoStore((s) => s.openDiff)

  // Keep the status "real-time": poll while the window is visible, full refresh on focus
  useEffect(() => {
    const { refreshStatus, refreshAll } = useRepoStore.getState()
    const tick = () => document.visibilityState === 'visible' && refreshStatus()
    const id = window.setInterval(tick, STATUS_POLL_MS)
    const onFocus = () => refreshAll()
    window.addEventListener('focus', onFocus)
    return () => {
      window.clearInterval(id)
      window.removeEventListener('focus', onFocus)
    }
  }, [])

  return (
    <div className="flex h-full flex-col">
      <Header />
      <div className="flex min-h-0 flex-1">
        <RefsSidebar />
        <main className="min-w-0 flex-1">{openDiff ? <DiffPanel target={openDiff} /> : <GraphView />}</main>
        {selected === 'wip' ? <WipPanel /> : selected ? <CommitPanel hash={selected} /> : null}
      </div>
    </div>
  )
}
