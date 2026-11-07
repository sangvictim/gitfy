import { useEffect, useState } from 'react'
import logo from '../../assets/logo.png'
import { Icon, type IconName } from '../../components/Icon'
import { useRepoStore } from '../../store/repo.store'
import { useUiStore } from '../../store/ui.store'
import { CloneModal } from './CloneModal'
import { useRepoActions } from './useRepoActions'

function ActionCard({ icon, title, desc, onClick }: { icon: IconName; title: string; desc: string; onClick: () => void }) {
  return (
    <button
      onClick={onClick}
      className="group flex items-start gap-3 rounded-lg border border-border bg-panel p-4 text-left transition-colors hover:border-accent/60 hover:bg-panel-2"
    >
      <span className="rounded-md bg-accent/15 p-2 text-accent">
        <Icon name={icon} size={18} />
      </span>
      <span>
        <span className="block text-sm font-semibold">{title}</span>
        <span className="mt-0.5 block text-xs text-muted">{desc}</span>
      </span>
    </button>
  )
}

export function WelcomeScreen() {
  const { recent, loadRecent, openRepo, removeRecent } = useRepoStore()
  const { openWithDialog, initWithDialog } = useRepoActions()
  const [cloning, setCloning] = useState(false)

  useEffect(() => {
    loadRecent()
  }, [loadRecent])

  return (
    <div className="flex h-full items-center justify-center overflow-auto p-8">
      <div className="w-full max-w-[640px]">
        <div className="mb-8 flex items-center gap-3">
          <img src={logo} alt="" width={52} height={52} draggable={false} />
          <div>
            <h1 className="text-2xl font-bold tracking-tight">Gitfy</h1>
            <p className="text-muted">Simply Git GUI Client</p>
          </div>
          <button
            onClick={() => useUiStore.getState().openSettings()}
            className="ml-auto flex items-center gap-1.5 rounded-md px-2.5 py-1.5 text-muted hover:bg-panel-2 hover:text-fg"
            title="Preferences"
          >
            <Icon name="settings" size={16} />
            Preferences
          </button>
        </div>

        <div className="grid gap-3 sm:grid-cols-3">
          <ActionCard icon="folder" title="Open" desc="Open a local repository" onClick={openWithDialog} />
          <ActionCard icon="download" title="Clone" desc="Clone from GitHub / GitLab" onClick={() => setCloning(true)} />
          <ActionCard icon="plus" title="Init" desc="Create a new repository" onClick={initWithDialog} />
        </div>

        <h2 className="mt-10 mb-2 text-xs font-semibold tracking-wider text-muted uppercase">Recent repositories</h2>
        {recent.length === 0 ? (
          <p className="rounded-lg border border-dashed border-border p-6 text-center text-muted">
            No recent repositories yet.
          </p>
        ) : (
          <ul className="overflow-hidden rounded-lg border border-border bg-panel">
            {recent.map((r) => (
              <li key={r.path} className="group flex items-center border-b border-border last:border-0">
                <button
                  onClick={() => openRepo(r.path)}
                  className="flex min-w-0 flex-1 items-center gap-3 px-4 py-2.5 text-left hover:bg-panel-2"
                >
                  <Icon name="folder" className="shrink-0 text-muted" />
                  <span className="min-w-0">
                    <span className="block truncate font-medium">{r.name}</span>
                    <span className="block truncate text-xs text-muted">{r.path}</span>
                  </span>
                </button>
                <button
                  onClick={() => removeRecent(r.path)}
                  className="mr-2 rounded p-1.5 text-muted opacity-0 group-hover:opacity-100 hover:bg-panel-2 hover:text-fg"
                  aria-label={`Remove ${r.name} from recent`}
                  title="Remove from list"
                >
                  <Icon name="x" size={14} />
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
      {cloning && <CloneModal onClose={() => setCloning(false)} />}
    </div>
  )
}
