import { useState } from 'react'
import { Button } from '../../components/Button'
import { Modal } from '../../components/Modal'
import { useRepoStore } from '../../store/repo.store'

export function DeleteBranchModal({ name, onClose }: { name: string; onClose: () => void }) {
  const deleteBranch = useRepoStore((s) => s.deleteBranch)
  const [force, setForce] = useState(false)
  const [submitting, setSubmitting] = useState(false)

  const submit = async () => {
    setSubmitting(true)
    const ok = await deleteBranch(name, force)
    setSubmitting(false)
    if (ok) onClose()
  }

  return (
    <Modal
      title="Delete branch"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="danger" disabled={submitting} onClick={submit}>
            Delete
          </Button>
        </>
      }
    >
      <p>
        Delete local branch <span className="font-mono font-semibold">{name}</span>?
      </p>
      <label className="flex items-start gap-2 text-[13px]">
        <input type="checkbox" className="mt-0.5" checked={force} onChange={(e) => setForce(e.target.checked)} />
        <span>
          Force delete
          <span className="block text-xs text-muted">Delete even if it has commits that are not merged anywhere.</span>
        </span>
      </label>
    </Modal>
  )
}
