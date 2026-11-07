import { useEffect } from 'react'
import { Icon, type IconName } from '../../components/Icon'
import { cx } from '../../lib/format'
import { useUiStore } from '../../store/ui.store'
import { SshSettingsSection } from './SshSettings'

/** Global preferences. Only SSH for now; more sections plug into the nav below. */
export function SettingsPage() {
  const close = useUiStore((s) => s.closeSettings)

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && close()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [close])

  return (
    <div className="flex h-full min-h-0">
      <nav className="flex w-64 shrink-0 flex-col border-r border-border bg-panel" aria-label="Preferences">
        <button
          onClick={close}
          className="flex h-12 items-center gap-2 px-4 text-[15px] text-fg hover:bg-panel-2"
          title="Exit Preferences (Esc)"
        >
          <Icon name="exit" size={17} />
          Exit Preferences
        </button>
        <div className="px-4 pt-3 pb-1.5 text-xs text-muted">Preferences</div>
        <NavItem icon="shield" label="SSH" active />
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto px-14 py-8">
        <h1 className="mb-7 text-2xl font-medium">SSH</h1>
        <SshSettingsSection />
      </main>
    </div>
  )
}

function NavItem({ icon, label, active }: { icon: IconName; label: string; active?: boolean }) {
  return (
    <button
      aria-current={active ? 'page' : undefined}
      className={cx(
        'flex h-11 items-center gap-3 px-6 text-left text-[15px]',
        active ? 'bg-accent/20 text-fg' : 'text-muted hover:bg-panel-2 hover:text-fg',
      )}
    >
      <Icon name={icon} size={17} className={active ? 'text-accent' : undefined} />
      {label}
    </button>
  )
}
