import { useEffect, useState } from 'react'
import { Button } from '../../components/Button'
import { Field, Input, TextArea } from '../../components/Input'
import { Modal } from '../../components/Modal'
import { useActiveGit, useRepoStore } from '../../store/repo.store'
import { PushedWarning, useRewriteInfo } from './RewriteWarning'

/** Rewrite the last commit's message (and include anything staged) */
export function AmendModal({ onClose }: { onClose: () => void }) {
  const git = useActiveGit()
  const amend = useRepoStore((s) => s.amend)
  const staged = useRepoStore((s) => s.status?.staged.length ?? 0)
  const [summary, setSummary] = useState<string | null>(null)
  const [description, setDescription] = useState('')
  const [running, setRunning] = useState(false)
  const info = useRewriteInfo('HEAD~1')

  useEffect(() => {
    git
      ?.headMessage()
      .then((msg) => {
        const [first, ...rest] = msg.split('\n')
        setSummary(first ?? '')
        setDescription(rest.join('\n').trim())
      })
      .catch(() => setSummary(''))
  }, [git])

  const submit = async () => {
    if (!summary?.trim()) return
    setRunning(true)
    const ok = await amend(summary, description)
    setRunning(false)
    if (ok) onClose()
  }

  return (
    <Modal
      title="Amend last commit"
      onClose={onClose}
      width={500}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={running || !summary?.trim()} onClick={submit}>
            Amend
          </Button>
        </>
      }
    >
      <Field label="Summary">
        <Input autoFocus value={summary ?? ''} disabled={summary === null} onChange={(e) => setSummary(e.target.value)} />
      </Field>
      <Field label="Description (optional)">
        <TextArea value={description} onChange={(e) => setDescription(e.target.value)} rows={4} />
      </Field>
      <p className="text-xs text-muted">
        {staged
          ? `Your ${staged} staged file${staged === 1 ? ' is' : 's are'} added to the commit too.`
          : 'Only the message changes. Stage files first to add them to the commit.'}{' '}
        Undo restores the original commit.
      </p>
      <PushedWarning info={info} verb="amend" />
    </Modal>
  )
}
