import { useState } from 'react'
import { Button } from '../../components/Button'
import { Field, Input, TextArea } from '../../components/Input'
import { Modal } from '../../components/Modal'
import { cx } from '../../lib/format'
import { useRepoStore } from '../../store/repo.store'

/** Tag a commit (HEAD when `target` is omitted) */
export function CreateTagModal({ target, onClose }: { target?: string; onClose: () => void }) {
  const tags = useRepoStore((s) => s.branches?.tags ?? [])
  const commits = useRepoStore((s) => s.commits)
  const createTag = useRepoStore((s) => s.createTag)
  const pushTags = useRepoStore((s) => s.pushTags)
  const hasRemote = useRepoStore((s) => (s.branches?.remotes.length ?? 0) > 0)
  const [name, setName] = useState('')
  const [message, setMessage] = useState('')
  const [push, setPush] = useState(false)
  const [running, setRunning] = useState(false)

  const commit = target ? commits.find((c) => c.hash === target) : commits.find((c) => c.refs.some((r) => r.current || r.type === 'head'))
  const n = name.trim()
  const error = !n
    ? null
    : /\s/.test(n)
      ? 'Tag names cannot contain spaces'
      : tags.some((t) => t.name === n)
        ? `A tag named '${n}' already exists`
        : null

  const submit = async () => {
    if (!n || error) return
    setRunning(true)
    const ok = await createTag(n, target, message)
    if (ok && push) await pushTags(n)
    setRunning(false)
    if (ok) onClose()
  }

  return (
    <Modal
      title="Create tag"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={running || !n || !!error} onClick={submit}>
            {push ? 'Create & push' : 'Create tag'}
          </Button>
        </>
      }
    >
      <p className="truncate text-[13px] text-muted">
        On{' '}
        <span className="font-mono text-fg">{commit?.shortHash ?? target?.slice(0, 7) ?? 'HEAD'}</span>
        {commit && <> — {commit.subject}</>}
      </p>
      <Field label="Name">
        <Input
          autoFocus
          value={name}
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder="e.g. v1.2.0"
          aria-invalid={!!error}
          className={cx(!!error && 'border-danger/60 focus:border-danger')}
        />
      </Field>
      {error && <p className="-mt-2 text-[11px] text-danger">{error}</p>}
      <Field label="Message (optional)" hint="With a message it becomes an annotated tag (records who tagged it and when).">
        <TextArea value={message} onChange={(e) => setMessage(e.target.value)} rows={3} placeholder="Release notes…" />
      </Field>
      {hasRemote && (
        <label className="flex items-center gap-2 text-[13px]">
          <input type="checkbox" className="accent-accent" checked={push} onChange={(e) => setPush(e.target.checked)} />
          Push the tag to the remote right away
        </label>
      )}
    </Modal>
  )
}
