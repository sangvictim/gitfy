import { useEffect } from 'react'
import { Icon, type IconName } from '../../components/Icon'
import { cx } from '../../lib/format'
import { useRepoStore } from '../../store/repo.store'
import { useUiStore, type SettingsSection } from '../../store/ui.store'
import { GitignoreSection, IdentitySection, LfsSection } from './RepoSettings'
import { SshSettingsSection } from './SshSettings'

const TITLES: Record<SettingsSection, string> = {
  ssh: 'SSH',
  identity: 'Identity',
  gitignore: '.gitignore',
  lfs: 'LFS & submodules',
}

/** Global preferences, plus settings of the active tab's repository */
export function SettingsPage() {
  const close = useUiStore((s) => s.closeSettings)
  const stored = useUiStore((s) => s.settingsSection)
  const setSection = useUiStore((s) => s.setSettingsSection)
  const repo = useRepoStore((s) => s.repo)
  // Repository pages only exist while a repository tab is active
  const section: SettingsSection = !repo && stored !== 'ssh' ? 'ssh' : stored

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[role=dialog]') && close()
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
        <NavItem icon="shield" label="SSH" active={section === 'ssh'} onClick={() => setSection('ssh')} />
        {repo && (
          <>
            <div className="truncate px-4 pt-5 pb-1.5 text-xs text-muted" title={repo.path}>
              Repository · <span className="text-fg">{repo.name}</span>
            </div>
            <NavItem icon="key" label="Identity" active={section === 'identity'} onClick={() => setSection('identity')} />
            <NavItem icon="ignore" label=".gitignore" active={section === 'gitignore'} onClick={() => setSection('gitignore')} />
            <NavItem icon="folder" label="LFS & submodules" active={section === 'lfs'} onClick={() => setSection('lfs')} />
          </>
        )}
      </nav>
      <main className="min-w-0 flex-1 overflow-y-auto px-14 py-8">
        <h1 className="mb-7 text-2xl font-medium">
          {TITLES[section]}
          {section !== 'ssh' && repo && <span className="ml-3 text-base text-muted">{repo.name}</span>}
        </h1>
        {section === 'ssh' && <SshSettingsSection />}
        {section === 'identity' && <IdentitySection key={repo?.path} />}
        {section === 'gitignore' && <GitignoreSection key={repo?.path} />}
        {section === 'lfs' && <LfsSection key={repo?.path} />}
      </main>
    </div>
  )
}

function NavItem({ icon, label, active, onClick }: { icon: IconName; label: string; active?: boolean; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
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
