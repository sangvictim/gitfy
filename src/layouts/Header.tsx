import { useEffect, useRef, useState } from 'react'
import { Icon } from '../components/Icon'
import { ToolButton } from '../components/ToolButton'
import { CreateBranchModal } from '../features/branch/CreateBranchModal'
import { CommitSearch } from '../features/commit/CommitSearch'
import { CloneModal } from '../features/repo/CloneModal'
import { StashModal } from '../features/stash/StashModal'
import { useRepoActions } from '../features/repo/useRepoActions'
import { cx } from '../lib/format'
import { ipc } from '../services/ipc'
import { useRepoStore } from '../store/repo.store'
import { toast } from '../store/toast.store'
import { useUiStore } from '../store/ui.store'
import type { PullMode } from '../types/git'

export function Header() {
  const { repo, status, branches, refreshAll, busy, history, undo, redo, pull, push, stashApply } = useRepoStore()
  const { openWithDialog } = useRepoActions()
  const [modal, setModal] = useState<'clone' | 'branch' | 'stash' | null>(null)
  const [refreshing, setRefreshing] = useState(false)

  const changes = (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0)
  const latestStash = branches?.stashes[0]
  const branchName = status?.detached ? 'detached HEAD' : (status?.branch ?? branches?.current ?? '—')

  return (
    <header className="flex h-14 shrink-0 items-center gap-1 border-b border-border bg-panel px-3">
      <button
        onClick={() => repo && ipc.revealRepo(repo.path).catch((e) => toast.error(e.message))}
        title={`${repo?.path}\nClick to open the folder`}
        className="flex max-w-[220px] min-w-0 flex-col rounded px-2 py-1 text-left hover:bg-panel-2"
      >
        <span className="text-[10px] text-muted">repository</span>
        <span className="truncate text-[14px] font-semibold">{repo?.name}</span>
      </button>
      <Icon name="chevron" size={14} className="text-muted" />
      <BranchSwitcher label={branchName} />

      <div className="flex flex-1 items-center justify-center gap-1">
        <ToolButton
          icon="undo"
          label="Undo"
          disabled={!history.undo || !!busy}
          title={history.undo ? `Undo ${history.undo}` : 'Nothing to undo'}
          onClick={undo}
        />
        <ToolButton
          icon="redo"
          label="Redo"
          disabled={!history.redo || !!busy}
          title={history.redo ? `Redo ${history.redo}` : 'Nothing to redo'}
          onClick={redo}
        />
        <PullButton disabled={!!busy} behind={status?.tracking ? status.behind : 0} onPull={pull} />
        <ToolButton
          icon="push"
          label="Push"
          disabled={!!busy || !status?.branch}
          badge={status?.tracking ? status.ahead : 0}
          title={
            status?.tracking
              ? `Push '${status.branch}' to ${status.tracking}${status.ahead ? ` (${status.ahead} commit${status.ahead === 1 ? '' : 's'})` : ''}`
              : `Push '${status?.branch ?? ''}' and set its upstream`
          }
          onClick={push}
        />
        <ToolButton
          icon="stash"
          label="Stash"
          disabled={!!busy || changes === 0}
          title={changes ? 'Stash your changes' : 'No changes to stash'}
          onClick={() => setModal('stash')}
        />
        <ToolButton
          icon="unstash"
          label="Pop"
          disabled={!!busy || !latestStash}
          badge={branches?.stashes.length ?? 0}
          title={latestStash ? `Pop the latest stash: ${latestStash.message}` : 'No stashes'}
          onClick={() => latestStash && stashApply(latestStash.ref, true)}
        />
        <ToolButton icon="branch" label="Branch" onClick={() => setModal('branch')} />
        <div className="mx-2 h-8 w-px bg-border" />
        <ToolButton
          icon="refresh"
          label="Refresh"
          spin={refreshing}
          onClick={async () => {
            setRefreshing(true)
            await refreshAll()
            setRefreshing(false)
          }}
        />
        <ToolButton icon="folder" label="Open" onClick={openWithDialog} />
        <ToolButton icon="download" label="Clone" onClick={() => setModal('clone')} />
      </div>

      {busy && <span className="mr-2 animate-pulse text-xs text-muted">{busy}</span>}
      <CommitSearch />
      <ToolButton icon="settings" label="Settings" title="Preferences" onClick={() => useUiStore.getState().openSettings()} />

      {modal === 'clone' && <CloneModal onClose={() => setModal(null)} />}
      {modal === 'branch' && <CreateBranchModal onClose={() => setModal(null)} />}
      {modal === 'stash' && <StashModal onClose={() => setModal(null)} />}
    </header>
  )
}

/** Pull with a small menu for the other remote actions */
function PullButton({
  disabled,
  behind,
  onPull,
}: {
  disabled: boolean
  behind: number
  onPull: (mode?: PullMode) => void
}) {
  const fetchAll = useRepoStore((s) => s.fetchAll)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  const items: { label: string; hint: string; run: () => void }[] = [
    { label: 'Fetch All', hint: 'Download from every remote without changing your branch', run: fetchAll },
    { label: 'Pull (fast-forward if possible)', hint: 'Merges if your branch has diverged', run: () => onPull('ff') },
    { label: 'Pull (fast-forward only)', hint: 'Refuses instead of creating a merge commit', run: () => onPull('ff-only') },
  ]

  return (
    <div ref={ref} className="relative flex items-stretch">
      <ToolButton
        icon="pull"
        label="Pull"
        disabled={disabled}
        badge={behind}
        title={behind ? `Pull ${behind} commit${behind === 1 ? '' : 's'} (fast-forward if possible)` : 'Pull (fast-forward if possible)'}
        onClick={() => onPull('ff')}
      />
      <button
        onClick={() => setOpen(!open)}
        disabled={disabled}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="More pull options"
        title="More pull options"
        className="-ml-1.5 flex w-4 items-start justify-center rounded pt-2 text-muted hover:bg-panel-2 hover:text-fg disabled:opacity-35"
      >
        <Icon name="down" size={12} />
      </button>
      {open && (
        <ul role="menu" className="absolute top-full left-0 z-30 mt-1 w-72 rounded-md border border-border bg-panel-2 py-1 shadow-xl">
          {items.map((it) => (
            <li key={it.label}>
              <button
                role="menuitem"
                onClick={() => {
                  setOpen(false)
                  it.run()
                }}
                className="flex w-full flex-col px-3 py-1.5 text-left hover:bg-bg"
              >
                <span className="text-[13px]">{it.label}</span>
                <span className="text-[11px] text-muted">{it.hint}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}

/** Current branch with a dropdown to switch to another local branch */
function BranchSwitcher({ label }: { label: string }) {
  const { branches, checkout, busy } = useRepoStore()
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && setOpen(false)
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false)
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
    }
  }, [open])

  return (
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="flex max-w-[240px] min-w-0 flex-col rounded px-2 py-1 text-left hover:bg-panel-2"
      >
        <span className="text-[10px] text-muted">branch</span>
        <span className="flex items-center gap-1.5 text-[14px] font-semibold">
          <span className="truncate">{label}</span>
          <Icon name="chevron" size={12} className="rotate-90 text-muted" />
        </span>
      </button>
      {open && (
        <ul
          role="listbox"
          className="absolute top-full left-0 z-30 mt-1 max-h-80 w-64 overflow-y-auto rounded-md border border-border bg-panel-2 py-1 shadow-xl"
        >
          {(branches?.local ?? []).length === 0 && <li className="px-3 py-1.5 text-xs text-muted">No branches yet</li>}
          {(branches?.local ?? []).map((b) => (
            <li
              key={b.name}
              role="option"
              aria-selected={b.current}
              onClick={() => {
                setOpen(false)
                if (!b.current && !busy) checkout(b.name)
              }}
              className={cx('flex h-7 cursor-default items-center gap-2 px-3', b.current ? 'text-fg' : 'hover:bg-bg')}
            >
              <Icon name={b.current ? 'check' : 'branch'} size={13} className={b.current ? 'text-ok' : 'text-muted'} />
              <span className={cx('truncate', b.current && 'font-semibold')}>{b.name}</span>
            </li>
          ))}
        </ul>
      )}
    </div>
  )
}
