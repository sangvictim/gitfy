import { avatarColor, initials } from '../../lib/avatar'
import { graphColor, type GraphRow } from './graph'

export const LANE_W = 22
export const ROW_H = 28
/** Horizontal padding so nodes (and the HEAD ring) in the outer lanes are never clipped */
export const GRAPH_PAD = 6
const NODE_R = 9.5
/** Corner radius where a line turns between lanes */
const BEND_R = 7

const x = (lane: number) => GRAPH_PAD + lane * LANE_W + LANE_W / 2

/** Pixel width needed to draw `lanes` lanes without clipping */
export const graphWidthFor = (lanes: number) => GRAPH_PAD * 2 + lanes * LANE_W

interface Props {
  row: GraphRow
  width: number
  kind: 'commit' | 'merge' | 'wip'
  isHead: boolean
  author: string
  /** Draw a connector from the left edge (the branch badge) to the node */
  connector: boolean
}

export function GraphCell({ row, width, kind, isHead, author, connector }: Props) {
  const mid = ROW_H / 2
  const color = graphColor(row.color)
  const cx = x(row.col)

  return (
    <svg width={width} height={ROW_H} className="block shrink-0" shapeRendering="geometricPrecision" aria-hidden="true">
      {/* Lane-coloured band from the node to the message column */}
      {kind !== 'wip' && (
        <rect x={cx} y={3} width={Math.max(0, width - cx)} height={ROW_H - 6} fill={color} opacity={0.13} />
      )}
      {connector && <line x1={0} y1={mid} x2={cx} y2={mid} stroke={color} strokeWidth={2} />}
      {row.segments.map((s, i) => {
        const stroke = graphColor(s.color)
        const dash = kind === 'wip' && s.span === 'bottom' ? '3 3' : undefined
        if (s.span === 'full') {
          return <line key={i} x1={x(s.from)} y1={0} x2={x(s.to)} y2={ROW_H} stroke={stroke} strokeWidth={2} />
        }
        const [y1, y2] = s.span === 'top' ? [0, mid] : [mid, ROW_H]
        if (s.from === s.to) {
          return (
            <line key={i} x1={x(s.from)} y1={y1} x2={x(s.to)} y2={y2} stroke={stroke} strokeWidth={2} strokeDasharray={dash} />
          )
        }
        const x1 = x(s.from)
        const x2 = x(s.to)
        const dir = x2 > x1 ? 1 : -1
        const r = Math.min(BEND_R, Math.abs(x2 - x1), mid)
        // Orthogonal lines with a rounded corner:
        //  bottom: leave the node horizontally, then turn down into the parent's lane
        //  top:    come down the child's lane, then turn horizontally into the node
        const d =
          s.span === 'bottom'
            ? `M${x1},${mid} H${x2 - dir * r} Q${x2},${mid} ${x2},${mid + r} V${ROW_H}`
            : `M${x1},0 V${mid - r} Q${x1},${mid} ${x1 + dir * r},${mid} H${x2}`
        return <path key={i} d={d} stroke={stroke} strokeWidth={2} fill="none" strokeDasharray={dash} />
      })}

      {kind === 'wip' ? (
        <circle cx={cx} cy={mid} r={NODE_R - 1} fill="var(--color-bg)" stroke={color} strokeWidth={2} strokeDasharray="3 2.5" />
      ) : kind === 'merge' ? (
        <circle cx={cx} cy={mid} r={4.5} fill={color} stroke="var(--color-bg)" strokeWidth={1.5} />
      ) : (
        <g>
          {isHead && <circle cx={cx} cy={mid} r={NODE_R + 3} fill="none" stroke={color} strokeWidth={1.5} />}
          <circle cx={cx} cy={mid} r={NODE_R} fill={avatarColor(author)} stroke={color} strokeWidth={1.5} />
          <text
            x={cx}
            y={mid + 0.5}
            textAnchor="middle"
            dominantBaseline="central"
            fontSize={7}
            fontWeight={700}
            fill="#fff"
            style={{ fontFamily: 'var(--font-sans)' }}
          >
            {initials(author)}
          </text>
        </g>
      )}
    </svg>
  )
}
