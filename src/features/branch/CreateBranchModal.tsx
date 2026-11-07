import { useState } from 'react'
import { Button } from '../../components/Button'
import { Field, Input } from '../../components/Input'
import { Modal } from '../../components/Modal'
import { useRepoStore } from '../../store/repo.store'

export function CreateBranchModal({ onClose }: { onClose: () => void }) {
  const { createBranch, branches } = useRepoStore()
  const [name, setName] = useState('')
  const [checkout, setCheckout] = useState(true)
  const [submitting, setSubmitting] = useState(false)

  const trimmed = name.trim()
  const exists = branches?.local.some((b) => b.name === trimmed)
  const canSubmit = trimmed && !exists && !/\s/.test(trimmed) && !submitting

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    const ok = await createBranch(trimmed, checkout)
    setSubmitting(false)
    if (ok) onClose()
  }

  return (
    <Modal
      title="Create branch"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            Create branch
          </Button>
        </>
      }
    >
      <form
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
        className="flex flex-col gap-3"
      >
        <Field
          label="Branch name"
          hint={
            exists
              ? 'A branch with this name already exists'
              : /\s/.test(trimmed)
                ? 'Branch names cannot contain spaces'
                : `Based on ${branches?.current ?? 'HEAD'}`
          }
        >
          <Input autoFocus value={name} onChange={(e) => setName(e.target.value)} placeholder="feature/my-change" />
        </Field>
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={checkout} onChange={(e) => setCheckout(e.target.checked)} />
          Switch to the new branch
        </label>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
