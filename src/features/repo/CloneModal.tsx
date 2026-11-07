import { useMemo, useState } from 'react'
import { Button } from '../../components/Button'
import { Field, Input } from '../../components/Input'
import { Modal } from '../../components/Modal'
import { useRepoStore } from '../../store/repo.store'
import { useRepoActions } from './useRepoActions'

function guessName(url: string) {
  const last = url.trim().replace(/[\\/]+$/, '').split(/[\\/:]/).pop() ?? ''
  return last.replace(/\.git$/, '')
}

export function CloneModal({ onClose }: { onClose: () => void }) {
  const cloneRepo = useRepoStore((s) => s.cloneRepo)
  const busy = useRepoStore((s) => s.busy)
  const { pick } = useRepoActions()
  const [url, setUrl] = useState('')
  const [parent, setParent] = useState('')
  const [name, setName] = useState('')

  const placeholderName = useMemo(() => guessName(url), [url])
  const canSubmit = url.trim() && parent && (name.trim() || placeholderName) && !busy

  const submit = async () => {
    if (!canSubmit) return
    const ok = await cloneRepo(url.trim(), parent, name.trim() || undefined)
    if (ok) onClose()
  }

  return (
    <Modal
      title="Clone repository"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            {busy ? 'Cloning…' : 'Clone'}
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          submit()
        }}
      >
        <Field label="Repository URL" hint="HTTPS or SSH, e.g. https://github.com/user/repo.git">
          <Input autoFocus value={url} onChange={(e) => setUrl(e.target.value)} placeholder="https://github.com/…" />
        </Field>
        <Field label="Clone into">
          <div className="flex gap-2">
            <Input value={parent} readOnly placeholder="Choose a parent folder" />
            <Button
              type="button"
              onClick={async () => {
                const dir = await pick('Choose where to clone')
                if (dir) setParent(dir)
              }}
            >
              Browse
            </Button>
          </div>
        </Field>
        <Field label="Folder name">
          <Input value={name} onChange={(e) => setName(e.target.value)} placeholder={placeholderName || 'repo'} />
        </Field>
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
