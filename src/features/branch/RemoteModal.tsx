import { useState } from 'react'
import { Button } from '../../components/Button'
import { Field, Input } from '../../components/Input'
import { ConfirmModal } from '../../components/ConfirmModal'
import { Modal } from '../../components/Modal'
import { useRepoStore } from '../../store/repo.store'
import type { RemoteInfo } from '../../types/git'

const NAME_RE = /^[A-Za-z0-9][A-Za-z0-9._-]*$/

/** Add a remote, or edit one when `edit` is given (rename and / or change its URL) */
export function RemoteModal({
  edit,
  onClose,
  onDone,
}: {
  edit?: RemoteInfo
  onClose: () => void
  onDone?: () => void
}) {
  const { addRemote, updateRemote, removeRemote, branches } = useRepoStore()
  const [confirmRemove, setConfirmRemove] = useState(false)
  const remotes = branches?.remotes ?? []
  const [name, setName] = useState(edit?.name ?? (remotes.some((r) => r.name === 'origin') ? '' : 'origin'))
  const [url, setUrl] = useState(edit?.url ?? '')
  const [submitting, setSubmitting] = useState(false)

  const n = name.trim()
  const u = url.trim()
  const exists = remotes.some((r) => r.name === n && r.name !== edit?.name)
  const nameInvalid = n.length > 0 && !NAME_RE.test(n)
  const unchanged = !!edit && n === edit.name && u === edit.url
  const canSubmit = n && u && !exists && !nameInvalid && !/\s/.test(u) && !unchanged && !submitting

  const submit = async () => {
    if (!canSubmit) return
    setSubmitting(true)
    const ok = edit ? await updateRemote(edit.name, n, u) : await addRemote(n, u)
    setSubmitting(false)
    if (ok) {
      onDone?.()
      onClose()
    }
  }

  return (
    <Modal
      title={edit ? `Edit remote “${edit.name}”` : 'Add remote'}
      onClose={onClose}
      footer={
        <>
          {edit && (
            <Button
              variant="ghost"
              className="mr-auto text-danger! hover:bg-danger/10!"
              disabled={submitting}
              onClick={() => setConfirmRemove(true)}
            >
              Remove remote
            </Button>
          )}
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            {edit ? 'Save' : 'Add remote'}
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
                : edit
                  ? 'Renaming also renames its remote-tracking branches'
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
      {confirmRemove && edit && (
        <ConfirmModal
          title={`Remove remote “${edit.name}”`}
          confirmLabel="Remove"
          danger
          onConfirm={async () => {
            const ok = await removeRemote(edit.name)
            if (ok) onClose()
            return ok
          }}
          onClose={() => setConfirmRemove(false)}
        >
          <p className="text-[13px]">
            Gitfy stops knowing about <span className="font-mono">{edit.url}</span>. Its remote branches disappear from the
            sidebar and branches tracking it lose their upstream. Nothing is deleted on the server.
          </p>
        </ConfirmModal>
      )}
    </Modal>
  )
}
