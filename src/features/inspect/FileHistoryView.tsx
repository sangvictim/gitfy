import { useEffect, useState } from 'react'
import { DiffViewer } from '../../components/DiffViewer'
import { FileStatusBadge } from '../../components/FileStatusBadge'
import { Icon } from '../../components/Icon'
import { avatarColor, initials } from '../../lib/avatar'
import { cx, relativeTime, splitPath } from '../../lib/format'
import { useActiveGit, useRepoStore } from '../../store/repo.store'
import type { DiffContent, FileHistoryEntry } from '../../types/git'
import { ViewHeader } from './ViewHeader'

/** Every commit that touched a file (following renames), with that commit's diff of the file */
export function FileHistoryView({ path }: { path: string }) {
  const git = useActiveGit()
  const setOpenDiff = useRepoStore((s) => s.setOpenDiff)
  const focusCommit = useRepoStore((s) => s.focusCommit)
  const [entries, setEntries] = useState<FileHistoryEntry[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [selected, setSelected] = useState(0)
  const [diff, setDiff] = useState<DiffContent | null>(null)

  useEffect(() => {
    if (!git) return
    let cancelled = false
    setEntries(null)
    git
      .fileHistory(path)
      .then((e) => {
        if (cancelled) return
        setEntries(e)
        setSelected(0)
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [git, path])

  const entry = entries?.[selected]
  useEffect(() => {
    if (!git || !entry) return
    let cancelled = false
    setDiff(null)
    git
      .commitFileDiff(entry.commit.hash, entry.path, entry.from)
      .then((d) => !cancelled && setDiff(d))
      .catch(() => !cancelled && setDiff(null))
    return () => {
      cancelled = true
    }
  }, [git, entry])

  const { dir, name } = splitPath(path)

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewHeader
        icon="history"
        title={
          <>
            History of <span className="text-muted">{dir}</span>
            <span className="font-semibold">{name}</span>
          </>
        }
        info={entries ? `${entries.length} commit${entries.length === 1 ? '' : 's'}` : undefined}
        actions={[{ icon: 'search', label: 'Blame', onClick: () => setOpenDiff({ kind: 'blame', path }) }]}
        onClose={() => setOpenDiff(null)}
      />
      <div className="flex min-h-0 flex-1">
        <ul className="w-[340px] shrink-0 overflow-y-auto border-r border-border py-1" role="listbox" aria-label="Commits">
          {error && <li className="px-3 py-2 text-xs text-danger">{error}</li>}
          {!entries && !error && <li className="px-3 py-2 text-xs text-muted">Loading history…</li>}
          {entries?.length === 0 && <li className="px-3 py-2 text-xs text-muted">This file has no committed history yet</li>}
          {entries?.map((e, i) => (
            <li
              key={e.commit.hash}
              role="option"
              aria-selected={i === selected}
              onClick={() => setSelected(i)}
              onDoubleClick={() => focusCommit(e.commit.hash)}
              title="Double-click to show the commit in the graph"
              className={cx('flex cursor-default gap-2.5 px-3 py-2', i === selected ? 'bg-accent/20' : 'hover:bg-panel-2')}
            >
              <span
                className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded text-[10px] font-bold text-white"
                style={{ background: avatarColor(e.commit.authorName) }}
              >
                {initials(e.commit.authorName)}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[13px]">{e.commit.subject}</span>
                <span className="flex items-center gap-1.5 text-[11px] text-muted">
                  <span className="font-mono">{e.commit.shortHash}</span>
                  <span className="truncate">
                    {e.commit.authorName} · {relativeTime(e.commit.date)}
                  </span>
                </span>
                {e.from && (
                  <span className="block truncate text-[11px] text-accent" title={`${e.from} → ${e.path}`}>
                    renamed from {e.from}
                  </span>
                )}
              </span>
              <FileStatusBadge type={e.status} />
            </li>
          ))}
        </ul>
        <div className="min-w-0 flex-1">
          {entry ? (
            <DiffViewer
              diff={diff}
              loading={!diff}
              title={
                <>
                  <span className="mr-2 rounded bg-panel-2 px-1.5 py-0.5 font-sans text-[10px] text-muted uppercase">
                    {entry.commit.shortHash}
                  </span>
                  {entry.path}
                </>
              }
              actions={
                <button
                  onClick={() => setOpenDiff({ kind: 'blame', path: entry.path, rev: entry.commit.hash })}
                  className="flex h-6 items-center gap-1 rounded px-1.5 font-sans text-[11px] text-muted hover:bg-panel-2 hover:text-fg"
                  title="Blame the file as it was in this commit"
                >
                  <Icon name="search" size={12} /> Blame here
                </button>
              }
            />
          ) : (
            <div className="flex h-full items-center justify-center text-muted">Select a commit</div>
          )}
        </div>
      </div>
    </div>
  )
}
