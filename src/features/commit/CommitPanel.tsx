import { useEffect, useState } from 'react'
import { FileStatusBadge } from '../../components/FileStatusBadge'
import { Icon } from '../../components/Icon'
import { avatarColor, initials } from '../../lib/avatar'
import { cx, fullDate, splitPath } from '../../lib/format'
import { useActiveGit, useRepoStore } from '../../store/repo.store'
import { toast } from '../../store/toast.store'
import type { Commit, CommitFile } from '../../types/git'
import { AmendModal } from '../rewrite/AmendModal'
import { PickRevertModal } from '../rewrite/PickRevertModal'
import { ResetModal } from '../rewrite/ResetModal'
import { CreateTagModal } from '../tag/CreateTagModal'

export function CommitPanel({ hash }: { hash: string }) {
  const { commits, select, openDiff, setOpenDiff, focusCommit } = useRepoStore()
  const git = useActiveGit()
  const fromList = commits.find((c) => c.hash === hash)
  const [fetched, setFetched] = useState<Commit | null>(null)
  const [files, setFiles] = useState<CommitFile[] | null>(null)
  const [tagging, setTagging] = useState(false)
  const stash = useRepoStore((s) => s.branches?.stashes.find((st) => st.commit === hash) ?? null)
  const isStash = !!stash
  const commit = fromList ?? (fetched?.hash === hash ? fetched : null)

  // Commits outside the loaded log (e.g. stashes) are fetched individually
  useEffect(() => {
    if (fromList || !git) return
    let cancelled = false
    git
      .getCommit(hash)
      .then((c) => !cancelled && setFetched(c))
      .catch((e) => toast.error(e.message))
    return () => {
      cancelled = true
    }
  }, [hash, fromList, git])

  useEffect(() => {
    if (!git) return
    let cancelled = false
    setFiles(null)
    git
      .commitFiles(hash)
      .then((f) => !cancelled && setFiles(f))
      .catch((e) => toast.error(e.message))
    return () => {
      cancelled = true
    }
  }, [hash, git])

  if (!commit) return <PanelShell onClose={() => select(null)} title="Loading…" />

  const counts = { M: 0, A: 0, D: 0, R: 0 }
  for (const f of files ?? []) {
    const k = (f.status === 'C' ? 'A' : f.status === 'T' ? 'M' : f.status) as keyof typeof counts
    if (k in counts) counts[k]++
  }

  const activePath = openDiff?.kind === 'commit' && openDiff.hash === hash ? openDiff.path : null

  return (
    <PanelShell
      onClose={() => select(null)}
      title={
        <span className="flex items-center gap-1.5">
          {isStash ? 'stash' : 'commit'}: <span className="font-mono">{isStash ? stash!.ref : commit.shortHash}</span>
          <button
            onClick={() => navigator.clipboard.writeText(commit.hash).then(() => toast.info('Commit hash copied'))}
            className="rounded p-0.5 text-muted hover:bg-panel-2 hover:text-fg"
            title="Copy full hash"
            aria-label="Copy commit hash"
          >
            <Icon name="copy" size={13} />
          </button>
          {!isStash && (
            <button
              onClick={() => setTagging(true)}
              className="ml-1 flex items-center gap-1 rounded px-1.5 py-0.5 text-[11px] text-muted hover:bg-panel-2 hover:text-fg"
              title="Create a tag on this commit"
            >
              <Icon name="tag" size={12} /> Tag
            </button>
          )}
          {tagging && <CreateTagModal target={commit.hash} onClose={() => setTagging(false)} />}
        </span>
      }
    >
      <div className="selectable m-3 rounded-md border border-border bg-bg p-3">
        <p className="text-[15px] leading-snug break-words">{commit.subject}</p>
        {commit.body && <p className="mt-2 text-xs whitespace-pre-wrap text-muted">{commit.body}</p>}
      </div>

      {!isStash && <CommitActions commit={commit} />}

      <div className="flex items-start gap-2.5 px-3">
        <span
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-md text-xs font-bold text-white"
          style={{ background: avatarColor(commit.authorName) }}
        >
          {initials(commit.authorName)}
        </span>
        <div className="min-w-0 flex-1">
          <p className="truncate font-medium" title={commit.authorEmail}>
            {commit.authorName}
          </p>
          <p className="text-xs text-muted">authored {fullDate(commit.date)}</p>
        </div>
        {commit.parents.length > 0 && !isStash && (
          <div className="shrink-0 text-right text-xs text-muted">
            parent{commit.parents.length > 1 ? 's' : ''}:{' '}
            {commit.parents.map((p) => (
              <button key={p} onClick={() => focusCommit(p)} className="ml-1 font-mono text-fg hover:text-accent hover:underline">
                {p.slice(0, 7)}
              </button>
            ))}
          </div>
        )}
      </div>

      <div className="mt-4 flex items-center gap-3 border-t border-border px-3 pt-3 pb-1.5 text-xs">
        {files === null ? (
          <span className="text-muted">Loading files…</span>
        ) : (
          <>
            {counts.M > 0 && <span className="text-warn">✎ {counts.M} modified</span>}
            {counts.A > 0 && <span className="text-ok">+ {counts.A} added</span>}
            {counts.D > 0 && <span className="text-danger">− {counts.D} deleted</span>}
            {counts.R > 0 && <span className="text-accent">→ {counts.R} renamed</span>}
            {files.length === 0 && <span className="text-muted">No file changes</span>}
          </>
        )}
      </div>

      <ul className="min-h-0 flex-1 overflow-y-auto pb-2">
        {(files ?? []).map((f) => {
          const { dir, name } = splitPath(f.path)
          return (
            <li
              key={f.path}
              onClick={() => setOpenDiff({ kind: 'commit', hash, path: f.path, from: f.from })}
              title={f.from ? `${f.from} → ${f.path}` : f.path}
              className={cx(
                'flex h-7 cursor-default items-center gap-2 px-3',
                activePath === f.path ? 'bg-accent/25' : 'hover:bg-panel-2',
              )}
            >
              <FileStatusBadge type={f.status} />
              <span className="min-w-0 flex-1 truncate">
                {dir && <span className="text-muted">{dir}</span>}
                <span>{name}</span>
              </span>
            </li>
          )
        })}
      </ul>
    </PanelShell>
  )
}

export function PanelShell({
  title,
  onClose,
  children,
}: {
  title: React.ReactNode
  onClose: () => void
  children?: React.ReactNode
}) {
  return (
    <aside className="flex w-[400px] shrink-0 flex-col border-l border-border bg-panel">
      <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
        <div className="min-w-0 flex-1 truncate text-[13px]">{title}</div>
        <button onClick={onClose} className="rounded p-1 text-muted hover:bg-panel-2 hover:text-fg" aria-label="Close panel">
          <Icon name="x" size={14} />
        </button>
      </div>
      <div className="flex min-h-0 flex-1 flex-col">{children}</div>
    </aside>
  )
}

/** Cherry-pick / revert / reset, depending on how the commit relates to the checked-out branch */
function CommitActions({ commit }: { commit: Commit }) {
  const git = useActiveGit()
  const busy = useRepoStore((s) => s.busy)
  const branch = useRepoStore((s) => s.status?.branch ?? null)
  const operation = useRepoStore((s) => s.status?.operation ?? null)
  // Re-check whenever HEAD moves
  const head = useRepoStore((s) => s.commits.find((c) => c.refs.some((r) => r.current || r.type === 'head'))?.hash)
  const [rel, setRel] = useState<{ hash: string; isHead: boolean; inHead: boolean } | null>(null)
  const [modal, setModal] = useState<'cherry-pick' | 'revert' | 'reset' | 'amend' | null>(null)

  useEffect(() => {
    if (!git) return
    let cancelled = false
    git
      .commitRelation(commit.hash)
      .then((r) => !cancelled && setRel({ hash: commit.hash, ...r }))
      .catch(() => !cancelled && setRel(null))
    return () => {
      cancelled = true
    }
  }, [git, commit.hash, head])

  if (!rel || rel.hash !== commit.hash) return null
  const target = branch ?? 'HEAD'
  const disabled = !!busy || !!operation
  const why = operation ? `Finish or abort the ${operation.kind} first` : undefined

  return (
    <div className="mx-3 -mt-1 mb-3 flex flex-wrap gap-1.5">
      {!rel.inHead && (
        <ActionButton
          icon="commit"
          label={`Cherry-pick onto ${target}`}
          title={why ?? `Copy this commit onto ${target}`}
          disabled={disabled}
          onClick={() => setModal('cherry-pick')}
        />
      )}
      {rel.inHead && (
        <ActionButton
          icon="undo"
          label="Revert"
          title={why ?? 'Add a commit that undoes this one'}
          disabled={disabled}
          onClick={() => setModal('revert')}
        />
      )}
      {rel.isHead && (
        <ActionButton
          icon="pencil"
          label="Amend"
          title={why ?? 'Edit the message of this commit (and add staged changes)'}
          disabled={disabled}
          onClick={() => setModal('amend')}
        />
      )}
      {!rel.isHead && (
        <ActionButton
          icon="history"
          label={`Reset ${target} to here`}
          title={why ?? `Move ${target} to this commit`}
          disabled={disabled}
          onClick={() => setModal('reset')}
        />
      )}
      {(modal === 'cherry-pick' || modal === 'revert') && (
        <PickRevertModal action={modal} commit={commit} onClose={() => setModal(null)} />
      )}
      {modal === 'reset' && <ResetModal commit={commit} onClose={() => setModal(null)} />}
      {modal === 'amend' && <AmendModal onClose={() => setModal(null)} />}
    </div>
  )
}

function ActionButton({
  icon,
  label,
  title,
  disabled,
  onClick,
}: {
  icon: 'commit' | 'undo' | 'history' | 'pencil'
  label: string
  title: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      disabled={disabled}
      onClick={onClick}
      title={title}
      className="flex h-7 max-w-full items-center gap-1.5 rounded-md border border-border bg-panel-2 px-2.5 text-[12px] hover:border-muted disabled:opacity-50"
    >
      <Icon name={icon} size={13} className="shrink-0 text-muted" />
      <span className="truncate">{label}</span>
    </button>
  )
}
