import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { cx } from '../../lib/format'
import { useActiveGit, useRepoStore } from '../../store/repo.store'

/** Branch / author pickers that narrow the graph */
export function GraphFilter() {
  const git = useActiveGit()
  const filter = useRepoStore((s) => s.logFilter)
  const setLogFilter = useRepoStore((s) => s.setLogFilter)
  const branches = useRepoStore((s) => s.branches)
  const [authors, setAuthors] = useState<string[]>([])

  useEffect(() => {
    if (!git) return
    let cancelled = false
    git
      .authors()
      .then((a) => !cancelled && setAuthors(a))
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [git])

  const active = !!filter.branch || !!filter.author
  const select =
    'h-5 max-w-[150px] cursor-pointer truncate rounded border bg-bg px-1 text-[11px] font-normal tracking-normal normal-case outline-none focus:border-accent'

  return (
    <span className="flex items-center gap-1.5">
      <Icon name="filter" size={11} className={active ? 'text-accent' : ''} />
      <select
        aria-label="Show branch"
        title="Show only the commits of one branch"
        value={filter.branch ?? ''}
        onChange={(e) => setLogFilter({ branch: e.target.value || null })}
        className={cx(select, filter.branch ? 'border-accent/60 text-fg' : 'border-border text-muted')}
      >
        <option value="">All branches</option>
        {(branches?.local ?? []).length > 0 && (
          <optgroup label="Local">
            {branches!.local.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </optgroup>
        )}
        {(branches?.remote ?? []).length > 0 && (
          <optgroup label="Remote">
            {branches!.remote.map((b) => (
              <option key={b.name} value={b.name}>
                {b.name}
              </option>
            ))}
          </optgroup>
        )}
      </select>
      <select
        aria-label="Show author"
        title="Show only the commits of one author"
        value={filter.author ?? ''}
        onChange={(e) => setLogFilter({ author: e.target.value || null })}
        className={cx(select, filter.author ? 'border-accent/60 text-fg' : 'border-border text-muted')}
      >
        <option value="">All authors</option>
        {authors.map((a) => (
          <option key={a} value={a}>
            {a}
          </option>
        ))}
      </select>
      {active && (
        <button
          onClick={() => setLogFilter({ branch: null, author: null })}
          title="Clear the filter"
          aria-label="Clear the filter"
          className="rounded p-0.5 text-muted hover:bg-panel-2 hover:text-fg"
        >
          <Icon name="x" size={11} />
        </button>
      )}
    </span>
  )
}
