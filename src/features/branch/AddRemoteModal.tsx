import { useState } from 'react'
import { Button } from '../../components/Button'
import { Field, Input } from '../../components/Input'
import { Modal } from '../../components/Modal'
import { useRepoStore } from '../../store/repo.store'

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

export function AddRemoteModal({ onClose, onAdded }: { onClose: () => void; onAdded?: () => void }) {
  const { addRemote, branches } = useRepoStore()
  const remotes = branches?.remotes ?? []
  const [name, setName] = useState(remotes.some((r) => r.name === 'origin') ? '' : 'origin')
  const [url, setUrl] = useState('')
  const [submitting, setSubmitting] = useState(false)

  const n = name.trim()
  const u = url.trim()
  const exists = remotes.some((r) => r.name === n)
  const nameInvalid = n.length > 0 && !NAME_RE.test(n)
  const canSubmit = n && u && !exists && !nameInvalid && !/\s/.test(u) && !submitting

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    const ok = await addRemote(n, u)
    setSubmitting(false)
    if (ok) {
      onAdded?.()
      onClose()
    }
  }

  return (
    <Modal
      title="Add remote"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            Add remote
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
          label="Remote name"
          hint={
            exists
              ? `A remote named "${n}" already exists`
              : nameInvalid
                ? 'Use letters, numbers, ".", "_" or "-"'
                : 'Usually "origin"'
          }
        >
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="origin" />
        </Field>
        <Field label="URL" hint="e.g. git@github.com:user/repo.git or https://github.com/user/repo.git">
          <Input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="git@github.com:user/repo.git" />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
