import { useState } from 'react'
import { ConfirmModal } from '../../components/ConfirmModal'
import { useRepoStore } from '../../store/repo.store'
import type { FileChange } from '../../types/git'
import { CommitForm } from '../commit/CommitForm'
import { PanelShell } from '../commit/CommitPanel'
import { ConflictList } from '../conflict/ConflictList'
import { FileList } from './FileList'

export function WipPanel() {
  const { status, select, openDiff, setOpenDiff, stage, unstage, stageAll, unstageAll, discard } = useRepoStore()
  const [discarding, setDiscarding] = useState<FileChange[] | null>(null)
  const total = new Set([...(status?.staged ?? []), ...(status?.unstaged ?? [])].map((f) => f.path)).size
  const branch = status?.detached ? 'detached HEAD' : (status?.branch ?? 'HEAD')
  const active = openDiff?.kind === 'working' ? openDiff : null

  const show = (f: FileChange, staged: boolean) =>
    setOpenDiff({ kind: 'working', path: f.path, staged, from: f.from })
  const toggle = (f: FileChange, staged: boolean) => {
    // Renames: unstage both sides so the index is restored correctly
    const paths = staged && f.from ? [f.path, f.from] : [f.path]
    return staged ? unstage(paths) : stage([f.path])
  }

  return (
    <PanelShell
      onClose={() => select(null)}
      title={
        <span>
          {total} file change{total === 1 ? '' : 's'} on <span className="font-semibold">{branch}</span>
        </span>
      }
    >
      <ConflictList />
      <FileList
        title="Unstaged Files"
        files={(status?.unstaged ?? []).filter((f) => f.type !== 'conflicted')}
        staged={false}
        selectedPath={active && !active.staged ? active.path : null}
        onSelect={(f) => show(f, false)}
        onToggle={(f) => toggle(f, false)}
        onToggleAll={stageAll}
        onDiscard={setDiscarding}
      />
      <FileList
        title="Staged Files"
        files={status?.staged ?? []}
        staged
        selectedPath={active?.staged ? active.path : null}
        onSelect={(f) => show(f, true)}
        onToggle={(f) => toggle(f, true)}
        onToggleAll={unstageAll}
      />
      <CommitForm />
      {discarding && (
        <DiscardModal
          files={discarding}
          onConfirm={() => discard(discarding.map((f) => f.path))}
          onClose={() => setDiscarding(null)}
        />
      )}
    </PanelShell>
  )
}

function DiscardModal({
  files,
  onConfirm,
  onClose,
}: {
  files: FileChange[]
  onConfirm: () => Promise<boolean>
  onClose: () => void
}) {
  const untracked = files.filter((f) => f.type === 'untracked').length
  const one = files.length === 1 ? files[0] : null
  return (
    <ConfirmModal
      title={one ? 'Discard changes' : `Discard ${files.length} files`}
      confirmLabel={untracked === files.length ? 'Delete' : 'Discard'}
      danger
      onConfirm={onConfirm}
      onClose={onClose}
    >
      <p className="text-[13px]">
        {one
          ? one.type === 'untracked'
            ? <>Delete the new file <span className="font-mono font-semibold">{one.path}</span>?</>
            : <>Throw away your unstaged changes to <span className="font-mono font-semibold">{one.path}</span>?</>
          : 'Throw away all unstaged changes?'}
      </p>
      {!one && (
        <ul className="max-h-40 overflow-y-auto rounded-md border border-border bg-bg px-2.5 py-1.5 font-mono text-xs text-muted">
          {files.map((f) => (
            <li key={f.path} className="truncate">
              {f.type === 'untracked' ? '+ ' : '~ '}
              {f.path}
            </li>
          ))}
        </ul>
      )}
      <p className="rounded-md bg-danger/10 px-2.5 py-2 text-xs text-danger">
        This can't be undone.{untracked > 0 && ` ${untracked} new file${untracked === 1 ? ' is' : 's are'} deleted from disk.`}{' '}
        Staged changes are kept.
      </p>
    </ConfirmModal>
  )
}
