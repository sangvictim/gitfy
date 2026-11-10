import { useState } from 'react'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { cx } from '../../lib/format'
import { OPERATION_NAME, useRepoStore } from '../../store/repo.store'
import { sideNames } from './labels'

/** Shown above the graph while a merge (or cherry-pick / revert / rebase) is waiting for the user */
export function OperationBanner() {
  const status = useRepoStore((s) => s.status)
  const busy = useRepoStore((s) => s.busy)
  const openConflict = useRepoStore((s) => s.openConflict)
  const continueOperation = useRepoStore((s) => s.continueOperation)
  const abortOperation = useRepoStore((s) => s.abortOperation)
  const [confirmAbort, setConfirmAbort] = useState(false)

  const op = status?.operation
  if (!op) return null
  const left = status.conflicted.length
  const names = sideNames(status)
  const what = OPERATION_NAME[op.kind]
  const title =
    op.kind === 'merge'
      ? `Merging ${names.theirs} into ${names.ours}`
      : op.kind === 'rebase'
        ? `Rebasing onto ${names.ours}`
        : `${what[0].toUpperCase()}${what.slice(1)} of ${op.incoming ?? 'a commit'}`
  const finish = op.kind === 'merge' ? 'Complete merge' : `Continue ${what}`

  return (
    <div
      role="status"
      className={cx(
        'flex shrink-0 items-center gap-3 border-b px-4 py-2',
        left ? 'border-danger/40 bg-danger/10' : 'border-ok/40 bg-ok/10',
      )}
    >
      <Icon name={left ? 'alert' : 'check'} size={16} className={cx('shrink-0', left ? 'text-danger' : 'text-ok')} />
      <div className="min-w-0 flex-1">
        <p className="truncate text-[13px] font-semibold" title={title}>
          {title}
        </p>
        <p className="text-xs text-muted">
          {left ? (
            <>
              {left} file{left === 1 ? ' has' : 's have'} conflicts. Choose which changes to keep in each one —{' '}
              <button onClick={() => openConflict(status.conflicted[0])} className="text-accent hover:underline">
                start with {status.conflicted[0].split('/').pop()}
              </button>
            </>
          ) : (
            `All conflicts are resolved. ${op.kind === 'merge' ? 'Complete the merge to create the merge commit.' : `Continue to finish the ${what}.`}`
          )}
        </p>
      </div>
      <Button size="sm" disabled={!!busy} onClick={() => setConfirmAbort(true)}>
        Abort {what}
      </Button>
      <Button
        size="sm"
        variant="primary"
        disabled={!!busy || left > 0}
        title={left ? 'Resolve every conflicted file first' : undefined}
        onClick={() => continueOperation()}
      >
        <Icon name="check" size={13} /> {finish}
      </Button>

      {confirmAbort && (
        <Modal
          title={`Abort the ${what}?`}
          onClose={() => setConfirmAbort(false)}
          footer={
            <>
              <Button onClick={() => setConfirmAbort(false)}>Keep going</Button>
              <Button
                variant="danger"
                autoFocus
                onClick={async () => {
                  setConfirmAbort(false)
                  await abortOperation()
                }}
              >
                Abort {what}
              </Button>
            </>
          }
        >
          <p className="text-[13px]">
            Your branch goes back to exactly how it was before the {what} started. Conflicts you already resolved are
            thrown away.
          </p>
        </Modal>
      )}
    </div>
  )
}
