import { useEffect, useMemo, useRef, useState } from 'react'
import { Icon } from '../../components/Icon'
import { ToolButton } from '../../components/ToolButton'
import { cx } from '../../lib/format'
import { commitMatches } from '../../lib/search'
import { useRepoStore } from '../../store/repo.store'

/**
 * Commit search in the header. Matching commits stay highlighted in the graph (others are dimmed);
 * Enter / Shift+Enter (or the arrows) jump between matches. Ctrl/Cmd+F opens it, Esc closes it.
 */
export function CommitSearch() {
  const commits = useRepoStore((s) => s.commits)
  const search = useRepoStore((s) => s.search)
  const setSearch = useRepoStore((s) => s.setSearch)
  const focusCommit = useRepoStore((s) => s.focusCommit)
  const [open, setOpen] = useState(search !== '')
  const [index, setIndex] = useState(0)
  const inputRef = useRef<HTMLInputElement>(null)

  const matches = useMemo(() => (search.trim() ? commits.filter((c) => commitMatches(c, search)) : []), [commits, search])

  // Ctrl/Cmd+F opens (or re-focuses) the search box
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'f') {
        e.preventDefault()
        setOpen(true)
        requestAnimationFrame(() => inputRef.current?.select())
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [])

  const jump = (i: number) => {
    if (matches.length === 0) return
    const next = (i + matches.length) % matches.length
    setIndex(next)
    focusCommit(matches[next].hash)
  }

  const close = () => {
    setSearch('')
    setOpen(false)
    setIndex(0)
  }

  if (!open) {
    return (
      <ToolButton
        icon="search"
        label="Search"
        onClick={() => {
          setOpen(true)
          requestAnimationFrame(() => inputRef.current?.focus())
        }}
      />
    )
  }

  const hasQuery = search.trim() !== ''
  return (
    <div className="flex h-9 w-80 items-center gap-1 rounded-md border border-border bg-bg pr-1 pl-2 focus-within:border-accent">
      <Icon name="search" size={14} className="shrink-0 text-muted" />
      <input
        ref={inputRef}
        autoFocus
        value={search}
        onChange={(e) => {
          setSearch(e.target.value)
          setIndex(0)
          const first = e.target.value.trim() ? commits.find((c) => commitMatches(c, e.target.value)) : undefined
          if (first) focusCommit(first.hash)
        }}
        onKeyDown={(e) => {
          if (e.key === 'Enter') jump(index + (e.shiftKey ? -1 : 1))
          else if (e.key === 'Escape') {
            e.stopPropagation()
            close()
          }
        }}
        placeholder="Search commits (message, author, hash)"
        aria-label="Search commits"
        className="min-w-0 flex-1 bg-transparent text-[13px] outline-none placeholder:text-muted/70"
      />
      {hasQuery && (
        <span className={cx('shrink-0 text-[11px] tabular-nums', matches.length ? 'text-muted' : 'text-danger')}>
          {matches.length ? `${index + 1} / ${matches.length}` : 'No results'}
        </span>
      )}
      <button
        onClick={() => jump(index - 1)}
        disabled={!matches.length}
        className="rounded p-0.5 text-muted hover:bg-panel-2 hover:text-fg disabled:opacity-40"
        title="Previous match (Shift+Enter)"
        aria-label="Previous match"
      >
        <Icon name="up" size={14} />
      </button>
      <button
        onClick={() => jump(index + 1)}
        disabled={!matches.length}
        className="rounded p-0.5 text-muted hover:bg-panel-2 hover:text-fg disabled:opacity-40"
        title="Next match (Enter)"
        aria-label="Next match"
      >
        <Icon name="down" size={14} />
      </button>
      <button
        onClick={close}
        className="rounded p-0.5 text-muted hover:bg-panel-2 hover:text-fg"
        title="Close search (Esc)"
        aria-label="Close search"
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  )
}
