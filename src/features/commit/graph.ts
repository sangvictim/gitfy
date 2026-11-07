import type { Commit } from '../../types/git'

export interface Segment {
  /** lane index at the start / end */
  from: number
  to: number
  /** vertical span of the segment within a row */
  span: 'top' | 'bottom' | 'full'
  color: number
}

export interface GraphRow {
  col: number
  color: number
  width: number
  segments: Segment[]
}

/**
 * Assigns each commit (in topological order, newest first) to a lane and computes
 * the line segments needed to draw it. Each row is drawn independently:
 *  - "top" segments run from the top edge to the commit dot (incoming children)
 *  - "bottom" segments run from the dot to the bottom edge (outgoing parents)
 *  - "full" segments are lanes that merely pass through this row
 */
export function computeGraph(commits: Commit[]): GraphRow[] {
  const lanes: (string | null)[] = []
  const colors: number[] = []
  let nextColor = 0
  const rows: GraphRow[] = []

  const freeSlot = () => {
    const i = lanes.indexOf(null)
    return i === -1 ? lanes.length : i
  }

  for (const c of commits) {
    const before = lanes.slice()
    const beforeColors = colors.slice()

    let col = lanes.indexOf(c.hash)
    if (col === -1) {
      // Branch tip nobody pointed at yet
      col = freeSlot()
      lanes[col] = c.hash
      colors[col] = nextColor++
    }
    const color = colors[col]

    // Other lanes waiting for this same commit converge into it
    for (let i = 0; i < lanes.length; i++) if (i !== col && lanes[i] === c.hash) lanes[i] = null

    // A branch keeps its own lane down to its fork point, even if another lane is already
    // heading to the same parent; the lanes converge (into the left-most one) at that parent.
    const [first, ...rest] = c.parents
    lanes[col] = first ?? null
    for (const p of rest) {
      if (lanes.includes(p)) continue
      const slot = freeSlot()
      lanes[slot] = p
      colors[slot] = nextColor++
    }
    while (lanes.length && lanes[lanes.length - 1] === null) {
      lanes.pop()
      colors.pop()
    }

    const segments: Segment[] = []
    before.forEach((h, i) => {
      if (h === null) return
      if (h === c.hash) segments.push({ from: i, to: col, span: 'top', color: beforeColors[i] })
      else segments.push({ from: i, to: i, span: 'full', color: beforeColors[i] })
    })
    c.parents.forEach((p, k) => {
      // First parent always continues straight down this commit's lane;
      // merge parents connect to whichever lane is (or now is) heading to them
      const j = k === 0 ? col : lanes.indexOf(p)
      if (j !== -1) segments.push({ from: col, to: j, span: 'bottom', color: j === col ? color : colors[j] })
    })

    rows.push({ col, color, width: Math.max(before.length, lanes.length, col + 1), segments })
  }
  return rows
}

export const GRAPH_COLORS = ['#1fb6d4', '#c04fd6', '#4f7bff', '#ef8a3c', '#3fb950', '#e4527a', '#d6b13f', '#8b6cf0']

/** Hash used for the virtual "uncommitted changes" row at the top of the graph */
export const WIP_HASH = '__WIP__'
export const graphColor = (i: number) => GRAPH_COLORS[i % GRAPH_COLORS.length]
