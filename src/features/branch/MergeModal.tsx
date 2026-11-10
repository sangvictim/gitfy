import { useState } from 'react'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { Modal } from '../../components/Modal'
import { useRepoStore } from '../../store/repo.store'

/** Confirm merging `from` (local or remote branch) into the checked-out branch */
export function MergeModal({ from, onClose }: { from: string; onClose: () => void }) {
  const status = useRepoStore((s) => s.status)
  const merge = useRepoStore((s) => s.merge)
  const busy = useRepoStore((s) => s.busy)
  const [noFf, setNoFf] = useState(false)
  const into = status?.branch ?? 'HEAD'
  const dirty = (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0) > 0

  const submit = async () => {
    onClose()
    await merge(from, noFf)
  }

  return (
    <Modal
      title="Merge branch"
      onClose={onClose}
      footer={
        <>
          <Button onClick={onClose}>Cancel</Button>
          <Button variant="primary" autoFocus disabled={!!busy || !status?.branch} onClick={submit}>
            Merge
          </Button>
        </>
      }
    >
      <div className="flex items-center gap-2 rounded-md border border-border bg-bg px-3 py-2.5 font-mono text-[13px]">
        <Icon name="branch" size={14} className="text-accent" />
        <span className="truncate font-semibold">{from}</span>
        <Icon name="chevron" size={14} className="shrink-0 text-muted" />
        <Icon name="branch" size={14} className="text-ok" />
        <span className="truncate font-semibold">{into}</span>
      </div>
      <p className="text-[13px] text-muted">
        Brings the commits from <span className="text-fg">{from}</span> into <span className="text-fg">{into}</span>. If both
        changed the same lines, you'll choose which changes to keep before the merge is finished — or abort it.
      </p>
      {!status?.branch && <p className="text-xs text-danger">Switch to a branch first — HEAD is detached.</p>}
      {dirty && (
        <p className="flex items-start gap-1.5 rounded-md bg-warn/10 px-2.5 py-2 text-xs text-warn">
          <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
          You have uncommitted changes. Commit them first so they don't get mixed up with the merge.
        </p>
      )}
      <label className="flex items-center gap-2 text-[13px]">
        <input type="checkbox" checked={noFf} onChange={(e) => setNoFf(e.target.checked)} className="accent-accent" />
        Always create a merge commit
        <span className="text-xs text-muted">(no fast-forward)</span>
      </label>
    </Modal>
  )
}
