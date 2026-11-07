import { useRepoStore } from '../../store/repo.store'
import type { FileChange } from '../../types/git'
import { CommitForm } from '../commit/CommitForm'
import { PanelShell } from '../commit/CommitPanel'
import { FileList } from './FileList'

export function WipPanel() {
  const { status, select, openDiff, setOpenDiff, stage, unstage, stageAll, unstageAll } = useRepoStore()
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
      <FileList
        title="Unstaged Files"
        files={status?.unstaged ?? []}
        staged={false}
        selectedPath={active && !active.staged ? active.path : null}
        onSelect={(f) => show(f, false)}
        onToggle={(f) => toggle(f, false)}
        onToggleAll={stageAll}
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
    </PanelShell>
  )
}
