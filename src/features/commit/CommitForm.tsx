import { useEffect, useRef, useState } from 'react'
import { Button } from '../../components/Button'
import { Icon } from '../../components/Icon'
import { Input, TextArea } from '../../components/Input'
import { cx } from '../../lib/format'
import { OPERATION_NAME, useActiveGit, useRepoStore } from '../../store/repo.store'
import { toast } from '../../store/toast.store'
import { PushedWarning, useRewriteInfo } from '../rewrite/RewriteWarning'

const SUMMARY_SOFT_LIMIT = 72

type Target = 'current' | 'new'

export function CommitForm() {
  const status = useRepoStore((s) => s.status)
  const branches = useRepoStore((s) => s.branches)
  const commit = useRepoStore((s) => s.commit)
  const continueOperation = useRepoStore((s) => s.continueOperation)
  const amendCommit = useRepoStore((s) => s.amend)
  const hasCommits = useRepoStore((s) => s.commits.length > 0)
  const busy = useRepoStore((s) => s.busy)
  const git = useActiveGit()
  const [amend, setAmend] = useState(false)
  /** What was typed before switching to amend, restored when switching back */
  const draft = useRef<{ summary: string; description: string } | null>(null)
  const amendInfo = useRewriteInfo(amend ? 'HEAD~1' : null)
  const [summary, setSummary] = useState('')
  const [description, setDescription] = useState('')
  const [target, setTarget] = useState<Target>('current')
  const [newBranch, setNewBranch] = useState('')

  const op = status?.operation ?? null
  const merging = op?.kind === 'merge'

  // During a merge, start from the message git prepared ("Merge branch 'x' into y"); clear it afterwards
  const prefilled = useRef<string | null>(null)
  useEffect(() => {
    const msg = merging ? op?.message : null
    if (msg && msg !== prefilled.current) {
      const [first, ...rest] = msg.split('\n')
      setSummary(first)
      setDescription(rest.join('\n').trim())
      prefilled.current = msg
    } else if (!op && prefilled.current) {
      setSummary('')
      setDescription('')
      prefilled.current = null
    }
  }, [merging, op, op?.message])

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

  const canCommit = op
    ? !busy && !hasConflicts && (!merging || summary.trim().length > 0)
    : amend
      ? summary.trim().length > 0 && !busy && !hasConflicts
      : summary.trim().length > 0 && stagedCount > 0 && !busy && !hasConflicts && !branchError

  const toggleAmend = async (on: boolean) => {
    if (!on) {
      setAmend(false)
      setSummary(draft.current?.summary ?? '')
      setDescription(draft.current?.description ?? '')
      draft.current = null
      return
    }
    if (!git) return
    try {
      // Start from the last commit's message
      const msg = await git.headMessage()
      draft.current = { summary, description }
      const [first, ...rest] = msg.split('\n')
      setSummary(first ?? '')
      setDescription(rest.join('\n').trim())
      setTarget('current')
      setAmend(true)
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  const submit = async () => {
    if (!canCommit) return
    if (amend && !op) {
      if (await amendCommit(summary, description)) {
        setAmend(false)
        draft.current = null
        setSummary('')
        setDescription('')
      }
      return
    }
    if (op) {
      const message = [summary.trim(), description.trim()].filter(Boolean).join('\n\n')
      await continueOperation(merging ? message : undefined)
      return
    }
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
      {op && (
        <p className="text-[11px] text-muted">
          {hasConflicts
            ? `Finish resolving the conflicts above, then complete the ${OPERATION_NAME[op.kind]}.`
            : merging
              ? 'All conflicts resolved. Adjust the merge message if you like, then complete the merge.'
              : `All conflicts resolved. Continuing uses the ${OPERATION_NAME[op.kind]}'s own commit message.`}
        </p>
      )}
      {(!op || merging) && (
        <>
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
        </>
      )}

      {/* Amend the last commit instead of making a new one */}
      {!op && hasCommits && (
        <label className="flex items-center gap-2 text-[12px] text-muted" title="Rewrite the last commit: new message, plus whatever is staged">
          <input type="checkbox" className="accent-accent" checked={amend} onChange={(e) => toggleAmend(e.target.checked)} />
          Amend last commit
        </label>
      )}
      {amend && !op && <PushedWarning info={amendInfo} verb="amend" />}

      {/* Where the commit goes */}
      {!op && !amend && (
        <>
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
        </>
      )}

      <Button type="submit" variant="primary" disabled={!canCommit} title="Ctrl+Enter">
        {hasConflicts
          ? 'Resolve conflicts first'
          : op
            ? merging
              ? 'Complete merge'
              : `Continue ${OPERATION_NAME[op.kind]}`
            : amend
              ? stagedCount
                ? `Amend last commit (+${files})`
                : 'Amend last commit (message only)'
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
