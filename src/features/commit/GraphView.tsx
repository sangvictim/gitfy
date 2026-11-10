import { useVirtualizer } from '@tanstack/react-virtual'
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { cx, relativeTime } from '../../lib/format'
import { commitMatches } from '../../lib/search'
import { useRepoStore } from '../../store/repo.store'
import type { Commit, CommitRef } from '../../types/git'
import { GraphFilter } from './GraphFilter'
import { computeGraph, graphColor, WIP_HASH, type GraphRow as GraphRowLayout } from './graph'
import { GraphCell, graphWidthFor, ROW_H } from './GraphCell'
import { groupRefs, RefBadgeView, type RefBadge } from './RefBadges'
import { toast } from '../../store/toast.store'

const REFS_W = 210
/** Lanes shown by default before the user widens the column */
const DEFAULT_MAX_LANES = 8
const GRAPH_W_KEY = 'gitfy.graphWidth.v2'
/** Never narrower than this, so the "Graph" header label and its resize handle stay readable even with a single lane */
const GRAPH_MIN_W = 76

function saveGraphWidth(w: number) {
  try {
    localStorage.setItem(GRAPH_W_KEY, String(w))
  } catch {
    /* storage unavailable — width just won't persist */
  }
}

function loadGraphWidth(): number | null {
  try {
    const v = Number(localStorage.getItem(GRAPH_W_KEY))
    return Number.isFinite(v) && v > 0 ? v : null
  } catch {
    return null
  }
}
const isHeadRef = (r: CommitRef) => r.type === 'head' || !!r.current

export function GraphView() {
  // Narrow subscriptions: status polling must not re-render the graph unless the change count moves
  const commits = useRepoStore((s) => s.commits)
  const selected = useRepoStore((s) => s.selected)
  const select = useRepoStore((s) => s.select)
  const focusRequest = useRepoStore((s) => s.focusRequest)
  const search = useRepoStore((s) => s.search)
  const changeCount = useRepoStore((s) => (s.status?.staged.length ?? 0) + (s.status?.unstaged.length ?? 0))
  const logFilter = useRepoStore((s) => s.logFilter)
  const setLogFilter = useRepoStore((s) => s.setLogFilter)
  const currentBranch = useRepoStore((s) => s.status?.branch ?? null)
  const filtered = !!logFilter.branch || !!logFilter.author
  // The working copy belongs to the checked-out branch: hide it while looking at another one
  const showWip = changeCount > 0 && (!logFilter.branch || logFilter.branch === currentBranch)
  const listRef = useRef<HTMLDivElement>(null)

  const headHash = useMemo(() => commits.find((c) => c.refs.some(isHeadRef))?.hash, [commits])

  // Uncommitted changes appear as a virtual commit on top of HEAD
  const rows: Commit[] = useMemo(() => {
    if (!showWip) return commits
    const wip: Commit = {
      hash: WIP_HASH,
      shortHash: '',
      parents: headHash ? [headHash] : [],
      authorName: '',
      authorEmail: '',
      date: new Date().toISOString(),
      commitDate: new Date().toISOString(),
      subject: '// WIP',
      body: '',
      refs: [],
    }
    return [wip, ...commits]
  }, [commits, showWip, headHash])

  const graph = useMemo(() => computeGraph(rows), [rows])
  const lanes = useMemo(() => Math.max(1, ...graph.map((r) => r.width)), [graph])
  const fullW = graphWidthFor(lanes)
  // User-chosen width (drag the header edge); never wider than needed
  const [userW, setUserW] = useState<number | null>(loadGraphWidth)
  const minW = Math.max(graphWidthFor(1), GRAPH_MIN_W)
  const graphW = Math.max(minW, Math.min(fullW, userW ?? graphWidthFor(Math.min(lanes, DEFAULT_MAX_LANES))))

  const startResize = (e: React.PointerEvent) => {
    e.preventDefault()
    const startX = e.clientX
    const startW = graphW
    let latest = startW
    const onMove = (ev: PointerEvent) => {
      latest = Math.max(minW, Math.min(fullW, startW + ev.clientX - startX))
      setUserW(latest)
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      document.body.style.cursor = ''
      saveGraphWidth(latest)
    }
    document.body.style.cursor = 'col-resize'
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
  }
  const columns = `${REFS_W}px ${graphW}px minmax(0,1fr)`

  // Everything a row needs, computed once per log change instead of on every render
  const rowData: RowData[] = useMemo(() => {
    let prevLabel: string | null = null
    return rows.map((c, i) => {
      const isWip = c.hash === WIP_HASH
      let timeLabel: string | null = null
      if (!isWip) {
        // Time separators wherever the relative time changes ("21 hours ago", "yesterday"...)
        const label = relativeTime(c.commitDate)
        if (label !== prevLabel) timeLabel = label
        prevLabel = label
      }
      return {
        commit: c,
        row: graph[i],
        color: graphColor(graph[i].color),
        isWip,
        kind: isWip ? 'wip' : c.parents.length > 1 ? 'merge' : 'commit',
        badges: isWip ? [] : groupRefs(c.refs),
        timeLabel,
        separator: !!timeLabel && i > 0,
        body: c.body ? c.body.split('\n').filter(Boolean).join(' | ') : '',
        tooltip: isWip ? undefined : `${c.shortHash} · ${c.authorName} · ${new Date(c.date).toLocaleString()}`,
      } satisfies RowData
    })
  }, [rows, graph])

  // Search: hashes of matching commits (others are dimmed)
  const matches = useMemo(() => {
    if (!search.trim()) return null
    return new Set(rows.filter((c) => c.hash !== WIP_HASH && commitMatches(c, search)).map((c) => c.hash))
  }, [rows, search])

  const virtualizer = useVirtualizer({
    count: rowData.length,
    getScrollElement: () => listRef.current,
    estimateSize: () => ROW_H,
    getItemKey: (i) => rowData[i].commit.hash,
    overscan: 20,
  })

  // Scroll to a commit when asked (sidebar branch click, search, parent link…).
  // With virtualization the row may not exist in the DOM yet, so scroll by index.
  useEffect(() => {
    if (!focusRequest) return
    const i = rowData.findIndex((r) => r.commit.hash === focusRequest.hash)
    if (i !== -1) virtualizer.scrollToIndex(i, { align: 'center' })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [focusRequest])

  const selectedId = selected === 'wip' ? WIP_HASH : selected

  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key !== 'ArrowDown' && e.key !== 'ArrowUp') return
    e.preventDefault()
    const i = rowData.findIndex((r) => r.commit.hash === selectedId)
    const nextIdx = Math.max(0, Math.min(rowData.length - 1, i + (e.key === 'ArrowDown' ? 1 : -1)))
    const next = rowData[nextIdx]
    if (!next) return
    select(next.isWip ? 'wip' : next.commit.hash)
    virtualizer.scrollToIndex(nextIdx, { align: 'auto' })
  }

  // Stable callbacks so memoised rows don't re-render when the parent does
  const onSelectRow = useCallback((d: RowData) => select(d.isWip ? 'wip' : d.commit.hash), [select])
  const onSwitchBadge = useCallback((b: RefBadge) => {
    const { busy, checkout } = useRepoStore.getState()
    if (busy || b.tag || b.detached) return
    if (b.current) {
      toast.info(`Already on branch '${b.label}'`)
      return
    }
    if (b.local) checkout(b.label)
    else if (b.remote) checkout(b.full ?? b.label, true)
  }, [])

  if (rows.length === 0 && filtered) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-2 text-muted">
        <p>No commits match the filter.</p>
        <div className="flex items-center gap-2 text-[11px]">
          <GraphFilter />
        </div>
        <button onClick={() => setLogFilter({ branch: null, author: null })} className="text-xs text-accent hover:underline">
          Show everything
        </button>
      </div>
    )
  }

  if (rows.length === 0) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-1 text-muted">
        <p>No commits yet.</p>
        <p className="text-xs">Create some files to start your first commit.</p>
      </div>
    )
  }

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div
        className="grid h-7 shrink-0 items-center border-b border-border bg-panel text-[10.5px] font-semibold tracking-wider text-muted uppercase"
        style={{ gridTemplateColumns: columns }}
      >
        <span className="px-3">Branch / Tag</span>
        <span className="relative flex h-full items-center overflow-hidden border-l border-border px-2" title={`${lanes} lanes`}>
          Graph
          <span
            onPointerDown={startResize}
            onDoubleClick={() => {
              setUserW(fullW)
              saveGraphWidth(fullW)
            }}
            className="absolute top-0 right-0 h-full w-1.5 cursor-col-resize hover:bg-accent/60"
            title="Drag to resize · double-click to fit all lanes"
          />
        </span>
        <span className="flex h-full min-w-0 items-center justify-between gap-2 border-l border-border px-3">
          <span className="truncate">Commit message</span>
          <GraphFilter />
        </span>
      </div>

      <div
        ref={listRef}
        tabIndex={0}
        onKeyDown={onKeyDown}
        role="listbox"
        aria-label="Commit graph"
        className="min-h-0 flex-1 overflow-x-hidden overflow-y-auto outline-none"
      >
        {/* Only the rows in (or near) the viewport are rendered */}
        <div className="relative w-full" style={{ height: virtualizer.getTotalSize() }}>
          {virtualizer.getVirtualItems().map((v) => {
            const d = rowData[v.index]
            const isSel = d.commit.hash === selectedId
            return (
              <GraphRow
                key={v.key}
                data={d}
                top={v.start}
                columns={columns}
                graphW={graphW}
                isSelected={isSel}
                isHead={d.commit.hash === headHash}
                dimmed={!!matches && !isSel && !matches.has(d.commit.hash)}
                onSelect={onSelectRow}
                onSwitchBadge={onSwitchBadge}
              />
            )
          })}
        </div>
      </div>
    </div>
  )
}

interface RowData {
  commit: Commit
  row: GraphRowLayout
  color: string
  isWip: boolean
  kind: 'commit' | 'merge' | 'wip'
  badges: RefBadge[]
  timeLabel: string | null
  separator: boolean
  body: string
  tooltip: string | undefined
}

interface GraphRowProps {
  data: RowData
  top: number
  columns: string
  graphW: number
  isSelected: boolean
  isHead: boolean
  dimmed: boolean
  onSelect: (d: RowData) => void
  onSwitchBadge: (b: RefBadge) => void
}

/** One commit row. Memoised: selecting a commit only re-renders the old and new selected rows. */
const GraphRow = memo(function GraphRow({
  data: d,
  top,
  columns,
  graphW,
  isSelected,
  isHead,
  dimmed,
  onSelect,
  onSwitchBadge,
}: GraphRowProps) {
  const { commit: c, color, badges } = d
  return (
    <div
      data-hash={c.hash}
      role="option"
      aria-selected={isSelected}
      onClick={() => onSelect(d)}
      className={cx(
        'group absolute top-0 left-0 grid w-full cursor-default items-center',
        isSelected ? 'bg-accent/25' : 'hover:bg-panel-2',
        d.separator && 'border-t border-border/70',
        dimmed && 'opacity-30',
      )}
      title={d.tooltip}
      style={{ gridTemplateColumns: columns, height: ROW_H, transform: `translateY(${top}px)` }}
    >
      {/* Branch / tag */}
      <div className="flex min-w-0 items-center gap-1 pl-2">
        {badges.length > 0 && (
          <>
            <RefBadgeView badge={badges[0]} color={color} onDoubleClick={() => onSwitchBadge(badges[0])} />
            {badges.length > 1 && (
              <span
                className="shrink-0 rounded px-1 text-[11px] text-muted"
                style={{ boxShadow: `inset 0 0 0 1px ${color}66` }}
                title={badges.slice(1).map((b) => b.label).join('\n')}
              >
                +{badges.length - 1}
              </span>
            )}
            <span className="h-[2px] min-w-2 flex-1" style={{ background: color }} />
          </>
        )}
      </div>

      {/* Graph */}
      <div className="h-full overflow-hidden">
        <GraphCell
          row={d.row}
          width={graphW}
          kind={d.kind}
          isHead={isHead}
          author={c.authorName}
          connector={badges.length > 0}
        />
      </div>

      {/* Message */}
      <div
        className="flex h-full min-w-0 items-center gap-2 border-l-[3px] pr-3 pl-2.5"
        style={{ borderColor: `${color}${isSelected ? 'ff' : '99'}` }}
      >
        {d.isWip ? (
          <>
            <span className="font-mono text-muted">// WIP</span>
            <WipCounts />
          </>
        ) : (
          <span className="min-w-0 truncate">
            <span>{c.subject}</span>
            {d.body && <span className="ml-2 text-muted/80">{d.body}</span>}
          </span>
        )}
      </div>

      {d.timeLabel && (
        <span className="pointer-events-none absolute top-0.5 right-2 rounded bg-panel-2 px-1.5 text-[10.5px] leading-4 text-muted shadow-[0_0_0_3px_var(--color-bg)]">
          {d.timeLabel}
        </span>
      )}
    </div>
  )
})

function WipCounts() {
  const status = useRepoStore((s) => s.status)
  if (!status) return null
  const all = [...status.unstaged, ...status.staged]
  const paths = new Set(all.map((f) => f.path))
  const count = (t: string[]) => new Set(all.filter((f) => t.includes(f.type)).map((f) => f.path)).size
  const conflicts = status.conflicted.length
  const modified = count(['modified', 'renamed', 'typechange'])
  const added = count(['added', 'untracked'])
  const deleted = count(['deleted'])
  return (
    <span className="flex items-center gap-2 text-xs" title={`${paths.size} changed file(s)`}>
      {conflicts > 0 && (
        <span className="rounded bg-danger/15 px-1.5 font-medium text-danger">
          ! {conflicts} conflict{conflicts === 1 ? '' : 's'}
        </span>
      )}
      {modified > 0 && <span className="text-warn">✎ {modified}</span>}
      {added > 0 && <span className="text-ok">+ {added}</span>}
      {deleted > 0 && <span className="text-danger">− {deleted}</span>}
    </span>
  )
}
