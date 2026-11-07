import { useEffect } from 'react'
import logo from '../assets/logo.png'
import { Icon } from '../components/Icon'
import { cx } from '../lib/format'
import { useRepoStore } from '../store/repo.store'

/** One tab per open repository, plus empty "New Tab"s that show the welcome screen */
export function TabBar() {
  const tabs = useRepoStore((s) => s.tabs)
  const activeTabId = useRepoStore((s) => s.activeTabId)
  const { newTab, switchTab, closeTab } = useRepoStore.getState()

  // Ctrl+T: new tab · Ctrl+Tab / Ctrl+Shift+Tab: next / previous tab
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!(e.ctrlKey || e.metaKey)) return
      const s = useRepoStore.getState()
      if (e.key.toLowerCase() === 't' && !e.shiftKey) {
        e.preventDefault()
        s.newTab()
      } else if (e.key === 'Tab' && s.tabs.length > 1) {
        e.preventDefault()
        const i = s.tabs.findIndex((t) => t.id === s.activeTabId)
        const next = s.tabs[(i + (e.shiftKey ? -1 : 1) + s.tabs.length) % s.tabs.length]
        s.switchTab(next.id)
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  return (
    <div className="flex h-9 shrink-0 items-stretch border-b border-border bg-bg">
      <div className="flex items-center px-3">
        <img src={logo} alt="Gitfy" width={20} height={20} draggable={false} />
      </div>
      <div role="tablist" aria-label="Open repositories" className="flex min-w-0 items-stretch overflow-x-auto">
        {tabs.map((t) => {
          const isActive = t.id === activeTabId
          const title = t.repo?.name ?? 'New Tab'
          return (
            <div
              key={t.id}
              role="tab"
              aria-selected={isActive}
              title={t.repo?.path ?? 'New Tab'}
              onClick={() => switchTab(t.id)}
              onAuxClick={(e) => e.button === 1 && closeTab(t.id)}
              className={cx(
                'group relative flex max-w-[220px] min-w-[120px] cursor-default items-center gap-2 border-r border-border pr-1.5 pl-3',
                isActive ? 'bg-panel text-fg' : 'text-muted hover:bg-panel-2/60 hover:text-fg',
              )}
            >
              {isActive && <span className="absolute inset-x-0 top-0 h-0.5 bg-accent" />}
              <Icon name={t.repo ? 'branch' : 'plus'} size={13} className={cx('shrink-0', isActive && 'text-accent')} />
              <span className="min-w-0 flex-1 truncate text-[13px]">{title}</span>
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  closeTab(t.id)
                }}
                aria-label={`Close ${title}`}
                title="Close tab (middle-click)"
                className={cx(
                  'rounded p-0.5 hover:bg-bg hover:text-fg',
                  isActive ? 'opacity-70' : 'opacity-0 group-hover:opacity-70',
                )}
              >
                <Icon name="x" size={13} />
              </button>
            </div>
          )
        })}
      </div>
      <button
        onClick={newTab}
        className="flex w-9 shrink-0 items-center justify-center text-muted hover:bg-panel-2/60 hover:text-fg"
        title="New tab (Ctrl+T)"
        aria-label="New tab"
      >
        <Icon name="plus" size={15} />
      </button>
    </div>
  )
}
