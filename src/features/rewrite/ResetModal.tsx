import { useState } from 'react'
import { ConfirmModal } from '../../components/ConfirmModal'
import { cx } from '../../lib/format'
import { useRepoStore } from '../../store/repo.store'
import type { Commit, ResetMode } from '../../types/git'
import { PushedWarning, useRewriteInfo } from './RewriteWarning'

const MODES: { mode: ResetMode; title: string; hint: string }[] = [
  { mode: 'soft', title: 'Soft', hint: 'Keep all changes, staged — ready to commit again' },
  { mode: 'mixed', title: 'Mixed', hint: 'Keep all changes, unstaged (default)' },
  { mode: 'hard', title: 'Hard', hint: 'Discard all changes, including uncommitted ones' },
]

/** Move the current branch to a commit */
export function ResetModal({
  commit,
  initialMode = 'mixed',
  onClose,
}: {
  commit: Commit
  initialMode?: ResetMode
  onClose: () => void
}) {
  const status = useRepoStore((s) => s.status)
  const reset = useRepoStore((s) => s.reset)
  const [mode, setMode] = useState<ResetMode>(initialMode)
  const info = useRewriteInfo(commit.hash)
  const branch = status?.branch ?? 'HEAD'
  const dirty = (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0)
  const n = info?.commits ?? 0

  return (
    <ConfirmModal
      title={`Reset ${branch} to ${commit.shortHash}`}
      confirmLabel={mode === 'hard' ? 'Reset and discard' : 'Reset'}
      danger={mode === 'hard'}
      onConfirm={() => reset(commit.hash, mode)}
      onClose={onClose}
    >
      <p className="truncate text-[13px] text-muted">
        Moves <span className="text-fg">{branch}</span> to <span className="font-mono text-fg">{commit.shortHash}</span> —{' '}
        {commit.subject}
      </p>
      {info && n > 0 && (
        <p className="text-[13px] text-muted">
          <span className="text-fg">
            {n} commit{n === 1 ? '' : 's'}
          </span>{' '}
          after it {n === 1 ? 'is' : 'are'} taken off the branch. Undo brings {n === 1 ? 'it' : 'them'} back.
        </p>
      )}
      <div role="radiogroup" aria-label="Reset mode" className="flex flex-col gap-1.5">
        {MODES.map((m) => (
          <label
            key={m.mode}
            className={cx(
              'flex cursor-pointer items-start gap-2.5 rounded-md border px-3 py-2',
              mode === m.mode ? (m.mode === 'hard' ? 'border-danger/60 bg-danger/10' : 'border-accent/60 bg-accent/10') : 'border-border hover:bg-panel-2',
            )}
          >
            <input type="radio" name="reset-mode" className="mt-1 accent-accent" checked={mode === m.mode} onChange={() => setMode(m.mode)} />
            <span>
              <span className={cx('text-[13px] font-medium', m.mode === 'hard' && 'text-danger')}>{m.title}</span>
              <span className="block text-xs text-muted">{m.hint}</span>
            </span>
          </label>
        ))}
      </div>
      {mode === 'hard' && dirty > 0 && (
        <p className="rounded-md bg-danger/10 px-2.5 py-2 text-xs text-danger">
          Your {dirty} uncommitted change{dirty === 1 ? '' : 's'} will be lost for good — Undo can only restore commits.
        </p>
      )}
      <PushedWarning info={info} verb="reset" />
    </ConfirmModal>
  )
}
