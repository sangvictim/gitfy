import { useState } from 'react'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { Input, TextArea } from '../../components/Input'
import { cx } from '../../lib/format'
import { useRepoStore } from '../../store/repo.store'

const SUMMARY_SOFT_LIMIT = 72

type Target = 'current' | 'new'

export function CommitForm() {
  const status = useRepoStore((s) => s.status)
  const branches = useRepoStore((s) => s.branches)
  const commit = useRepoStore((s) => s.commit)
  const busy = useRepoStore((s) => s.busy)
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [target, setTarget] = useState<Target>('current')
  const [newBranch, setNewBranch] = useState('')

  const stagedCount = status?.staged.length ?? 0
  const hasConflicts = (status?.conflicted.length ?? 0) > 0
  const branch = status?.detached ? 'detached HEAD' : (status?.branch ?? 'HEAD')

  // New-branch name checks (the main process validates again with git check-ref-format)
  const name = newBranch.trim()
  const branchError =
    target !== 'new'
      ? null
      : !name
        ? 'Enter a name for the new branch'
        : /\s/.test(name)
          ? 'Branch names cannot contain spaces'
          : branches?.local.some((b) => b.name === name)
            ? `A branch named '${name}' already exists`
            : null

  const canCommit = summary.trim().length > 0 && stagedCount > 0 && !busy && !hasConflicts && !branchError

  const submit = async () => {
    if (!canCommit) return
    if (await commit(summary, description, target === 'new' ? name : undefined)) {
      setSummary('')
      setDescription('')
      setNewBranch('')
      setTarget('current')
    }
  }

  const files = `${stagedCount} file${stagedCount === 1 ? '' : 's'}`

  return (
    <form
      className="flex shrink-0 flex-col gap-2 border-t border-border bg-panel p-3"
      onSubmit={(e) => {
        e.preventDefault()
        submit()
      }}
    >
      <div className="relative">
        <Input
          value={summary}
          onChange={(e) => setSummary(e.target.value)}
          placeholder="Summary (required)"
          aria-label="Commit summary"
          className="pr-10"
        />
        <span
          className={`absolute top-1/2 right-2 -translate-y-1/2 text-[10px] ${
            summary.length > SUMMARY_SOFT_LIMIT ? 'text-warn' : 'text-muted'
          }`}
        >
          {summary.length}
        </span>
      </div>
      <TextArea
        value={description}
        onChange={(e) => setDescription(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) submit()
        }}
        placeholder="Description (optional)"
        aria-label="Commit description"
        rows={3}
      />

      {/* Where the commit goes */}
      <div role="radiogroup" aria-label="Commit to" className="flex rounded-md border border-border p-0.5 text-[12px]">
        <TargetOption
          active={target === 'current'}
          onClick={() => setTarget('current')}
          icon="branch"
          label={branch}
          hint="Commit on the current branch"
        />
        <TargetOption
          active={target === 'new'}
          onClick={() => setTarget('new')}
          icon="plus"
          label="New branch"
          hint="Create a branch from here and commit on it"
        />
      </div>
      {target === 'new' && (
        <div>
          <Input
            autoFocus
            value={newBranch}
            onChange={(e) => setNewBranch(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault()
                submit()
              }
            }}
            placeholder="New branch name, e.g. feature/my-change"
            aria-label="New branch name"
            aria-invalid={!!branchError && !!name}
            className={cx(!!branchError && !!name && 'border-danger/60 focus:border-danger')}
          />
          <p className={cx('mt-1 text-[11px]', branchError && name ? 'text-danger' : 'text-muted')}>
            {branchError && name ? branchError : `Created from ${branch}; your staged changes move with you.`}
          </p>
        </div>
      )}

      <Button type="submit" variant="primary" disabled={!canCommit} title="Ctrl+Enter">
        {hasConflicts
          ? 'Resolve conflicts first'
          : stagedCount === 0
            ? 'Stage files to commit'
            : target === 'new'
              ? `Commit ${files} to new branch${name ? ` '${name}'` : ''}`
              : `Commit ${files} to ${branch}`}
      </Button>
    </form>
  )
}

function TargetOption({
  active,
  onClick,
  icon,
  label,
  hint,
}: {
  active: boolean
  onClick: () => void
  icon: 'branch' | 'plus'
  label: string
  hint: string
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      onClick={onClick}
      title={hint}
      className={cx(
        'flex min-w-0 flex-1 items-center justify-center gap-1.5 rounded px-2 py-1',
        active ? 'bg-accent/20 text-fg' : 'text-muted hover:text-fg',
      )}
    >
      <Icon name={icon} size={12} className={cx('shrink-0', active && 'text-accent')} />
      <span className="truncate">{label}</span>
    </button>
  )
}
