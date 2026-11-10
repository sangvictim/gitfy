import { useEffect, useState } from 'react'
import { DiffViewer } from '../../components/DiffViewer'
import { FileStatusBadge } from '../../components/FileStatusBadge'
import { Icon } from '../../components/Icon'
import { cx, relativeTime, splitPath } from '../../lib/format'
import { useActiveGit, useRepoStore } from '../../store/repo.store'
import type { Commit, CommitFile, CompareResult, DiffContent } from '../../types/git'
import { LineStats } from './LineStats'
import { ViewHeader } from './ViewHeader'

type Tab = 'files' | 'commits'

/** What `head` has that `base` doesn't: its commits, and the files it changed since they split */
export function CompareView({ base, head }: { base: string; head: string }) {
  const git = useActiveGit()
  const setOpenDiff = useRepoStore((s) => s.setOpenDiff)
  const focusCommit = useRepoStore((s) => s.focusCommit)
  const [data, setData] = useState<CompareResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [tab, setTab] = useState<Tab>('files')
  const [file, setFile] = useState<CommitFile | null>(null)
  const [diff, setDiff] = useState<DiffContent | null>(null)

  useEffect(() => {
    if (!git) return
    let cancelled = false
    setData(null)
    setError(null)
    git
      .compare(base, head)
      .then((d) => {
        if (cancelled) return
        setData(d)
        setFile(d.files[0] ?? null)
        setTab(d.files.length ? 'files' : 'commits')
      })
      .catch((e) => !cancelled && setError(e instanceof Error ? e.message : String(e)))
    return () => {
      cancelled = true
    }
  }, [git, base, head])

  useEffect(() => {
    if (!git || !file) return
    let cancelled = false
    setDiff(null)
    git
      .compareFileDiff(base, head, file.path, file.from)
      .then((d) => !cancelled && setDiff(d))
      .catch(() => !cancelled && setDiff(null))
    return () => {
      cancelled = true
    }
  }, [git, base, head, file])

  const adds = data?.files.reduce((n, f) => n + (f.additions ?? 0), 0) ?? 0
  const dels = data?.files.reduce((n, f) => n + (f.deletions ?? 0), 0) ?? 0

  return (
    <div className="flex h-full min-h-0 flex-col">
      <ViewHeader
        icon="branch"
        title={
          <span className="flex items-center gap-1.5">
            <span className="font-sans text-muted">Compare</span>
            <span className="font-semibold text-accent">{head}</span>
            <span className="font-sans text-muted">with</span>
            <span className="font-semibold text-ok">{base}</span>
          </span>
        }
        actions={[
          {
            icon: 'refresh',
            label: 'Swap',
            title: 'Swap the two branches',
            onClick: () => setOpenDiff({ kind: 'compare', base: head, head: base }),
          },
        ]}
        onClose={() => setOpenDiff(null)}
      />

      {error ? (
        <div className="flex flex-1 items-center justify-center text-danger">{error}</div>
      ) : !data ? (
        <div className="flex flex-1 items-center justify-center text-muted">Comparing…</div>
      ) : (
        <>
          <div className="flex shrink-0 flex-wrap items-center gap-x-4 gap-y-1 border-b border-border bg-panel px-4 py-2 text-[12.5px]">
            <span>
              <span className="font-semibold text-accent">{data.ahead.length}</span> commit{data.ahead.length === 1 ? '' : 's'}{' '}
              only in <span className="font-mono">{head}</span>
            </span>
            <span>
              <span className="font-semibold text-ok">{data.behind.length}</span> commit{data.behind.length === 1 ? '' : 's'}{' '}
              only in <span className="font-mono">{base}</span>
            </span>
            <span className="text-muted">
              {data.files.length} file{data.files.length === 1 ? '' : 's'} changed
              {data.files.length > 0 && (
                <>
                  {' '}
                  (<span className="text-ok">+{adds}</span> <span className="text-danger">−{dels}</span>)
                </>
              )}
            </span>
            {data.mergeBase && (
              <span className="text-muted">
                split at{' '}
                <button onClick={() => focusCommit(data.mergeBase!)} className="font-mono text-fg hover:text-accent hover:underline">
                  {data.mergeBase.slice(0, 7)}
                </button>
              </span>
            )}
          </div>

          <div className="flex min-h-0 flex-1">
            <div className="flex w-[340px] shrink-0 flex-col border-r border-border">
              <div role="tablist" className="flex shrink-0 gap-1 border-b border-border p-1.5 text-[12px]">
                {(
                  [
                    ['files', `Files (${data.files.length})`],
                    ['commits', `Commits (${data.ahead.length + data.behind.length})`],
                  ] as const
                ).map(([t, label]) => (
                  <button
                    key={t}
                    role="tab"
                    aria-selected={tab === t}
                    onClick={() => setTab(t)}
                    className={cx('flex-1 rounded px-2 py-1', tab === t ? 'bg-panel-2 text-fg' : 'text-muted hover:text-fg')}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto py-1">
                {tab === 'files' ? (
                  data.files.length === 0 ? (
                    <p className="px-3 py-2 text-xs text-muted">
                      {head} has no changes of its own compared with {base}.
                    </p>
                  ) : (
                    data.files.map((f) => {
                      const { dir, name } = splitPath(f.path)
                      return (
                        <button
                          key={f.path}
                          onClick={() => setFile(f)}
                          title={f.from ? `${f.from} → ${f.path}` : f.path}
                          className={cx(
                            'flex h-7 w-full items-center gap-2 px-3 text-left',
                            file?.path === f.path ? 'bg-accent/20' : 'hover:bg-panel-2',
                          )}
                        >
                          <FileStatusBadge type={f.status} />
                          <span className="min-w-0 flex-1 truncate">
                            {dir && <span className="text-muted">{dir}</span>}
                            {name}
                          </span>
                          <LineStats file={f} />
                        </button>
                      )
                    })
                  )
                ) : (
                  <>
                    <CommitGroup title={`Only in ${head}`} tone="text-accent" commits={data.ahead} onOpen={focusCommit} />
                    <CommitGroup title={`Only in ${base}`} tone="text-ok" commits={data.behind} onOpen={focusCommit} />
                  </>
                )}
              </div>
            </div>
            <div className="min-w-0 flex-1">
              {file ? (
                <DiffViewer
                  diff={diff}
                  loading={!diff}
                  title={
                    <>
                      <span className="mr-2 rounded bg-panel-2 px-1.5 py-0.5 font-sans text-[10px] text-muted uppercase">
                        {base}…{head}
                      </span>
                      {file.from ? `${file.from} → ` : ''}
                      {file.path}
                    </>
                  }
                />
              ) : (
                <div className="flex h-full items-center justify-center text-muted">
                  {data.files.length ? 'Select a file' : 'Nothing to show'}
                </div>
              )}
            </div>
          </div>
        </>
      )}
    </div>
  )
}

function CommitGroup({
  title,
  tone,
  commits,
  onOpen,
}: {
  title: string
  tone: string
  commits: Commit[]
  onOpen: (hash: string) => void
}) {
  return (
    <section className="mb-2">
      <h3 className={cx('px-3 py-1 text-[11px] font-semibold tracking-wide uppercase', tone)}>
        {title} <span className="font-normal text-muted">{commits.length}</span>
      </h3>
      {commits.length === 0 && <p className="px-3 py-1 text-xs text-muted">None</p>}
      {commits.map((c) => (
        <button
          key={c.hash}
          onClick={() => onOpen(c.hash)}
          title="Show in the graph"
          className="flex w-full items-start gap-2 px-3 py-1.5 text-left hover:bg-panel-2"
        >
          <Icon name="commit" size={13} className={cx('mt-0.5 shrink-0', tone)} />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-[13px]">{c.subject}</span>
            <span className="block truncate text-[11px] text-muted">
              <span className="font-mono">{c.shortHash}</span> · {c.authorName} · {relativeTime(c.date)}
            </span>
          </span>
        </button>
      ))}
    </section>
  )
}
