import { Icon } from '../../components/Icon'
import type { CommitRef } from '../../types/git'

export interface RefBadge {
  label: string
  local: boolean
  remote: boolean
  tag: boolean
  current: boolean
  detached: boolean
  /** Full ref name when the label is shortened (remote-only branches) */
  full?: string
}

/** Turns commit refs into badges, merging a local branch with its same-named remote branch(es). */
export function groupRefs(refs: CommitRef[]): RefBadge[] {
  const badges: RefBadge[] = []
  const base = { local: false, remote: false, tag: false, current: false, detached: false }
  const locals = new Map<string, RefBadge>()

  for (const r of refs) {
    if (r.type === 'local') {
      const b = { ...base, label: r.name, local: true, current: !!r.current }
      locals.set(r.name, b)
      badges.push(b)
    } else if (r.type === 'head') badges.push({ ...base, label: 'HEAD', detached: true })
    else if (r.type === 'tag') badges.push({ ...base, label: r.name, tag: true })
  }
  for (const r of refs) {
    if (r.type !== 'remote') continue
    const local = locals.get(r.name.split('/').slice(1).join('/'))
    if (local) local.remote = true
    else badges.push({ ...base, label: r.name.split('/').slice(1).join('/'), remote: true, full: r.name })
  }

  const rank = (b: RefBadge) => (b.current ? 0 : b.detached ? 1 : b.local ? 2 : b.remote ? 3 : 4)
  return badges.sort((a, b) => rank(a) - rank(b))
}

export function RefBadgeView({
  badge,
  color,
  onDoubleClick,
}: {
  badge: RefBadge
  color: string
  /** Double-click action (switch to this branch) */
  onDoubleClick?: () => void
}) {
  const canSwitch = !!onDoubleClick && !badge.tag && !badge.detached
  return (
    <span
      className="flex h-[22px] min-w-0 shrink items-center gap-1 rounded px-1.5 text-[12px] font-medium text-fg"
      style={{ background: `${color}33`, boxShadow: `inset 0 0 0 1px ${color}88` }}
      data-ref={badge.full ?? badge.label}
      onDoubleClick={
        canSwitch
          ? (e) => {
              e.stopPropagation()
              onDoubleClick()
            }
          : undefined
      }
      title={
        [badge.full ?? badge.label, badge.local && 'local', badge.remote && 'remote', badge.tag && 'tag']
          .filter(Boolean)
          .join(' · ') + (canSwitch && !badge.current ? '\nDouble-click to switch to this branch' : '')
      }
    >
      {badge.current && <Icon name="check" size={12} className="shrink-0" />}
      {badge.tag && <Icon name="tag" size={12} className="shrink-0" />}
      <span className="truncate">{badge.label}</span>
      {badge.local && <Icon name="laptop" size={12} className="shrink-0 opacity-80" />}
      {badge.remote && <Icon name="cloud" size={12} className="shrink-0 opacity-80" />}
    </span>
  )
}
