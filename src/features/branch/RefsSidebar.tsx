import { useMemo, useState } from 'react'
import { Icon, type IconName } from '../../components/Icon'
import { cx } from '../../lib/format'
import { useRepoStore } from '../../store/repo.store'
import { toast } from '../../store/toast.store'
import type { Branch } from '../../types/git'
import { AddRemoteModal } from './AddRemoteModal'
import { DeleteBranchModal } from './DeleteBranchModal'

type SectionId = 'local' | 'remote' | 'stashes' | 'tags'

export function RefsSidebar() {
  const { branches, checkout, busy, focusCommit, select, selected, fetchAll } = useRepoStore()
  const [filter, setFilter] = useState('')
  const [open, setOpen] = useState<Record<SectionId, boolean>>({ local: false, remote: false, stashes: false, tags: false })
  const [collapsedRemotes, setCollapsedRemotes] = useState<Set<string>>(new Set())
  const [deleting, setDeleting] = useState<string | null>(null)
  const [addingRemote, setAddingRemote] = useState(false)

  const q = filter.trim().toLowerCase()
  const has = (s: string) => s.toLowerCase().includes(q)

  const local = (branches?.local ?? []).filter((b) => has(b.name))
  const remote = (branches?.remote ?? []).filter((b) => has(b.name))
  const stashes = (branches?.stashes ?? []).filter((s) => has(s.message) || has(s.ref))
  const tags = (branches?.tags ?? []).filter((t) => has(t.name))

  // Group remote branches by remote name: origin/feature/x -> { origin: [feature/x] }
  const remoteGroups = useMemo(() => {
    const groups = new Map<string, Branch[]>()
    // Configured remotes show up even before anything was fetched from them
    for (const r of branches?.remotes ?? []) if (has(r.name)) groups.set(r.name, [])
    for (const b of remote) {
      const [name] = b.name.split('/')
      groups.set(name, [...(groups.get(name) ?? []), b])
    }
    return [...groups.entries()]
  }, [remote, branches?.remotes, q]) // eslint-disable-line react-hooks/exhaustive-deps

  const toggle = (id: SectionId) => setOpen((o) => ({ ...o, [id]: !o[id] }))
  const forced = q.length > 0 // while filtering, show every section expanded

  return (
    <aside className="flex w-64 shrink-0 flex-col border-r border-border bg-panel">
      <div className="p-2">
        <div className="relative">
          <Icon name="filter" size={13} className="absolute top-1/2 left-2 -translate-y-1/2 text-muted" />
          <input
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter branches, tags, stashes"
            aria-label="Filter refs"
            className="h-7 w-full rounded-md border border-border bg-bg pr-2 pl-7 text-xs outline-none placeholder:text-muted/70 focus:border-accent"
          />
        </div>
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto pb-3">
        <Section id="local" icon="laptop" label="Local" count={local.length} open={forced || open.local} onToggle={toggle}>
          {local.length === 0 && <Empty>{branches?.current ? `${branches.current} (no commits)` : 'No branches'}</Empty>}
          {local.map((b) => (
            <Row
              key={b.name}
              icon={b.current ? 'check' : 'branch'}
              iconClass={b.current ? 'text-ok' : undefined}
              label={b.name}
              bold={b.current}
              active={selected === b.commit}
              title={`${b.name} · ${b.commit.slice(0, 7)} ${b.label}\nDouble-click to switch`}
              onClick={() => focusCommit(b.commit)}
              onDoubleClick={() => {
                if (b.current) toast.info(`Already on branch '${b.name}'`)
                else if (!busy) checkout(b.name)
              }}
              actions={
                !b.current && (
                  <>
                    <RowAction disabled={!!busy} onClick={() => checkout(b.name)} label="Switch" />
                    <RowAction onClick={() => setDeleting(b.name)} icon="trash" label={`Delete ${b.name}`} danger />
                  </>
                )
              }
            />
          ))}
        </Section>

        <Section
          id="remote"
          icon="cloud"
          label="Remote"
          count={remote.length}
          open={forced || open.remote}
          onToggle={toggle}
          headerAction={
            <button
              onClick={() => {
                setOpen((o) => ({ ...o, remote: true }))
                setAddingRemote(true)
              }}
              aria-label="Add remote"
              title="Add remote"
              className="mr-1.5 rounded p-1 text-muted hover:bg-panel-2 hover:text-fg"
            >
              <Icon name="plus" size={13} />
            </button>
          }
        >
          {remoteGroups.length === 0 && (
            <Empty>
              No remotes{' '}
              <button onClick={() => setAddingRemote(true)} className="text-accent hover:underline">
                Add remote
              </button>
            </Empty>
          )}
          {remoteGroups.map(([name, list]) => {
            const collapsed = !forced && collapsedRemotes.has(name)
            const url = branches?.remotes.find((r) => r.name === name)?.url
            return (
              <div key={name}>
                <button
                  onClick={() =>
                    setCollapsedRemotes((s) => {
                      const n = new Set(s)
                      if (n.has(name)) n.delete(name)
                      else n.add(name)
                      return n
                    })
                  }
                  className="flex h-7 w-full items-center gap-1.5 pl-5 text-left hover:bg-panel-2"
                >
                  <Icon name="chevron" size={11} className={cx('text-muted transition-transform', !collapsed && 'rotate-90')} />
                  <Icon name="cloud" size={13} className="text-muted" />
                  <span className="truncate" title={url}>
                    {name}
                  </span>
                </button>
                {!collapsed && url && (
                  <p className="truncate pl-10 pr-2 pb-0.5 text-[11px] text-muted/80" title={url}>
                    {url}
                  </p>
                )}
                {!collapsed && list.length === 0 && (
                  <Empty indent>
                    No branches yet.{' '}
                    <button disabled={!!busy} onClick={() => fetchAll()} className="text-accent hover:underline disabled:opacity-50">
                      Fetch
                    </button>
                  </Empty>
                )}
                {!collapsed &&
                  list.map((b) => (
                    <Row
                      key={b.name}
                      indent
                      icon="branch"
                      label={b.name.slice(name.length + 1)}
                      active={selected === b.commit}
                      title={`${b.name} · ${b.commit.slice(0, 7)} ${b.label}\nDouble-click to check out`}
                      onClick={() => focusCommit(b.commit)}
                      onDoubleClick={() => !busy && checkout(b.name, true)}
                      actions={<RowAction disabled={!!busy} onClick={() => checkout(b.name, true)} label="Checkout" />}
                    />
                  ))}
              </div>
            )
          })}
        </Section>

        <Section id="stashes" icon="stash" label="Stashes" count={stashes.length} open={forced || open.stashes} onToggle={toggle}>
          {stashes.length === 0 && <Empty>No stashes</Empty>}
          {stashes.map((s) => (
            <Row
              key={s.ref}
              icon="stash"
              label={s.message}
              active={selected === s.commit}
              title={`${s.ref}: ${s.message}`}
              onClick={() => select(s.commit)}
            />
          ))}
        </Section>

        <Section id="tags" icon="tag" label="Tags" count={tags.length} open={forced || open.tags} onToggle={toggle}>
          {tags.length === 0 && <Empty>No tags</Empty>}
          {tags.map((t) => (
            <Row
              key={t.name}
              icon="tag"
              label={t.name}
              active={selected === t.commit}
              title={`${t.name} · ${t.commit.slice(0, 7)}`}
              onClick={() => focusCommit(t.commit)}
            />
          ))}
        </Section>
      </div>

      {addingRemote && (
        <AddRemoteModal
          onAdded={() => setOpen((o) => ({ ...o, remote: true }))}
          onClose={() => setAddingRemote(false)}
        />
      )}
      {deleting && <DeleteBranchModal name={deleting} onClose={() => setDeleting(null)} />}
    </aside>
  )
}

function Section({
  id,
  icon,
  label,
  count,
  open,
  onToggle,
  headerAction,
  children,
}: {
  id: SectionId
  icon: IconName
  label: string
  count: number
  open: boolean
  onToggle: (id: SectionId) => void
  headerAction?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <section className="border-b border-border/60">
      <div className="flex items-center">
        <button
          onClick={() => onToggle(id)}
          aria-expanded={open}
          className="flex h-8 min-w-0 flex-1 items-center gap-2 px-2 text-left text-[11.5px] font-semibold tracking-wide text-muted uppercase hover:text-fg"
        >
          <Icon name="chevron" size={12} className={cx('transition-transform', open && 'rotate-90')} />
          <Icon name={icon} size={14} />
          <span className="flex-1">{label}</span>
          <span className="font-normal text-muted">{count}</span>
        </button>
        {headerAction}
      </div>
      {open && <div className="pb-1.5">{children}</div>}
    </section>
  )
}

function Row({
  icon,
  iconClass,
  label,
  bold,
  active,
  indent,
  title,
  onClick,
  onDoubleClick,
  actions,
}: {
  icon: IconName
  iconClass?: string
  label: string
  bold?: boolean
  active?: boolean
  indent?: boolean
  title?: string
  onClick?: () => void
  onDoubleClick?: () => void
  actions?: React.ReactNode
}) {
  return (
    <div
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      title={title}
      className={cx(
        'group flex h-7 cursor-default items-center gap-2 pr-1.5',
        indent ? 'pl-10' : 'pl-7',
        active ? 'bg-accent/20' : 'hover:bg-panel-2',
      )}
    >
      <Icon name={icon} size={13} className={cx('shrink-0', iconClass ?? 'text-muted')} />
      <span className={cx('min-w-0 flex-1 truncate', bold && 'font-semibold')}>{label}</span>
      {actions && <div className="flex opacity-0 group-hover:opacity-100">{actions}</div>}
    </div>
  )
}

function RowAction({
  onClick,
  label,
  icon,
  danger,
  disabled,
}: {
  onClick: () => void
  label: string
  icon?: IconName
  danger?: boolean
  disabled?: boolean
}) {
  return (
    <button
      disabled={disabled}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      aria-label={label}
      title={label}
      className={cx(
        'rounded px-1.5 py-0.5 text-[11px] hover:bg-bg disabled:opacity-50',
        icon ? (danger ? 'text-muted hover:text-danger' : 'text-muted hover:text-fg') : 'text-accent',
      )}
    >
      {icon ? <Icon name={icon} size={13} /> : label}
    </button>
  )
}

function Empty({ children, indent }: { children: React.ReactNode; indent?: boolean }) {
  return <p className={cx('py-1 text-xs text-muted', indent ? 'pl-10' : 'pl-7')}>{children}</p>
}
