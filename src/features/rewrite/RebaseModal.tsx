import { ConfirmModal } from '../../components/ConfirmModal'
import { Icon } from '../../components/Icon'
import { useRepoStore } from '../../store/repo.store'
import { PushedWarning, useRewriteInfo } from './RewriteWarning'

/** Confirm rebasing the checked-out branch onto `onto` */
export function RebaseModal({ onto, onClose }: { onto: string; onClose: () => void }) {
  const status = useRepoStore((s) => s.status)
  const rebase = useRepoStore((s) => s.rebase)
  const info = useRewriteInfo(onto)
  const branch = status?.branch ?? 'HEAD'
  const dirty = (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0) > 0
  const n = info?.commits ?? 0

  return (
    <ConfirmModal title="Rebase branch" confirmLabel="Rebase" onConfirm={() => rebase(onto)} onClose={onClose}>
      <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-2.5 font-mono text-[13px]">
        <Icon name="branch" size={14} className="text-ok" />
        <span className="truncate font-semibold">{branch}</span>
        <span className="font-sans text-xs text-muted">onto</span>
        <Icon name="branch" size={14} className="text-accent" />
        <span className="truncate font-semibold">{onto}</span>
      </div>
      <p className="text-[13px] text-muted">
        Replays {info ? <span className="text-fg">{n} commit{n === 1 ? '' : 's'}</span> : 'the commits'} of{' '}
        <span className="text-fg">{branch}</span> on top of <span className="text-fg">{onto}</span>, giving a straight
        history without a merge commit. The replayed commits get new hashes. If a commit conflicts you resolve it, then
        continue — or abort to go back.
      </p>
      <PushedWarning info={info} verb="rebase" />
      {dirty && (
        <p className="flex items-start gap-1.5 rounded-md bg-warn/10 px-2.5 py-2 text-xs text-warn">
          <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
          You have uncommitted changes. Commit or stash them first — git won't rebase over them.
        </p>
      )}
    </ConfirmModal>
  )
}
