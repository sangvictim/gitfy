import { ConfirmModal } from '../../components/ConfirmModal'
import { useRepoStore } from '../../store/repo.store'
import type { Commit } from '../../types/git'

/** Confirm cherry-picking or reverting a commit on the current branch */
export function PickRevertModal({ action, commit, onClose }: { action: 'cherry-pick' | 'revert'; commit: Commit; onClose: () => void }) {
  const branch = useRepoStore((s) => s.status?.branch ?? 'HEAD')
  const cherryPick = useRepoStore((s) => s.cherryPick)
  const revert = useRepoStore((s) => s.revert)
  const merge = commit.parents.length > 1
  const pick = action === 'cherry-pick'
  return (
    <ConfirmModal
      title={pick ? 'Cherry-pick commit' : 'Revert commit'}
      confirmLabel={pick ? 'Cherry-pick' : 'Revert'}
      onConfirm={() => (pick ? cherryPick(commit.hash) : revert(commit.hash))}
      onClose={onClose}
    >
      <div className="rounded-md border border-border bg-bg px-3 py-2.5 text-[13px]">
        <span className="font-mono text-muted">{commit.shortHash}</span> {commit.subject}
      </div>
      <p className="text-[13px] text-muted">
        {pick ? (
          <>
            Copies the changes of this commit onto <span className="text-fg">{branch}</span> as a new commit.
          </>
        ) : (
          <>
            Adds a new commit on <span className="text-fg">{branch}</span> that undoes this commit's changes. History is
            not rewritten, so this is safe on pushed branches.
          </>
        )}{' '}
        {merge && 'This is a merge commit: its changes are taken relative to its first parent.'}
      </p>
    </ConfirmModal>
  )
}
