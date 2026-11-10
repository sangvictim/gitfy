import { useState } from 'react'
import { Button } from '../../components/Button'
import { Field, Input } from '../../components/Input'
import { Modal } from '../../components/Modal'
import { useRepoStore } from '../../store/repo.store'

/** Save the working copy as a stash, leaving a clean working tree */
export function StashModal({ onClose }: { onClose: () => void }) {
  const status = useRepoStore((s) => s.status)
  const stashPush = useRepoStore((s) => s.stashPush)
  const [message, setMessage] = useState('')
  const [untracked, setUntracked] = useState(true)
  const [running, setRunning] = useState(false)

  const files = new Set([...(status?.staged ?? []), ...(status?.unstaged ?? [])].map((f) => f.path)).size
  const untrackedCount = status?.unstaged.filter((f) => f.type === 'untracked').length ?? 0

  const submit = async () => {
    setRunning(true)
    const ok = await stashPush(message, untracked)
    setRunning(false)
    if (ok) onClose()
  }

  return (
    <Modal
      title="Stash changes"
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant="primary" disabled={running || files === 0} onClick={submit}>
            Stash {files} file{files === 1 ? '' : 's'}
          </Button>
        </>
      }
    >
      <p className="text-[13px] text-muted">
        Puts your changes aside and gives you a clean working copy. Apply or pop the stash later from the sidebar.
      </p>
      <Field label="Message (optional)">
        <Input
          autoFocus
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && submit()}
          placeholder={`WIP on ${status?.branch ?? 'HEAD'}`}
        />
      </Field>
      <label className="flex items-start gap-2 text-[13px]">
        <input type="checkbox" className="mt-0.5 accent-accent" checked={untracked} onChange={(e) => setUntracked(e.target.checked)} />
        <span>
          Include untracked files
          <span className="block text-xs text-muted">
            {untrackedCount ? `${untrackedCount} new file${untrackedCount === 1 ? '' : 's'} not yet added to Git.` : 'New files not yet added to Git.'}
          </span>
        </span>
      </label>
    </Modal>
  )
}
