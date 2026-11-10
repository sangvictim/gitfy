import { Icon } from '../../components/Icon'
import { cx, splitPath } from '../../lib/format'
import { useRepoStore } from '../../store/repo.store'
import { describeConflict, sideNames } from './labels'

/** "Conflicts" section at the top of the WIP panel */
export function ConflictList() {
  const status = useRepoStore((s) => s.status)
  const openDiff = useRepoStore((s) => s.openDiff)
  const openConflict = useRepoStore((s) => s.openConflict)
  const resolveConflict = useRepoStore((s) => s.resolveConflict)
  const busy = useRepoStore((s) => s.busy)
  const conflicts = status?.conflicts ?? []
  if (conflicts.length === 0) return null
  const names = sideNames(status)
  const activePath = openDiff?.kind === 'conflict' ? openDiff.path : null

  return (
    <section className="flex max-h-[45%] min-h-0 shrink-0 flex-col border-b border-danger/30">
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-danger/10 px-3">
        <Icon name="alert" size={13} className="text-danger" />
        <span className="text-xs font-semibold tracking-wide text-danger uppercase">Conflicts</span>
        <span className="rounded-full bg-danger/20 px-1.5 text-[11px] text-danger">{conflicts.length}</span>
        <div className="flex-1" />
        <span className="text-[11px] text-muted">click a file to resolve</span>
      </header>
      <ul className="min-h-0 overflow-y-auto py-1" role="listbox" aria-label="Conflicted files">
        {conflicts.map((c) => {
          const { dir, name } = splitPath(c.path)
          const selected = activePath === c.path
          return (
            <li
              key={c.path}
              role="option"
              aria-selected={selected}
              onClick={() => openConflict(c.path)}
              title={c.path}
              className={cx(
                'group flex h-10 cursor-default items-center gap-2 px-3',
                selected ? 'bg-accent/20' : 'hover:bg-panel-2',
              )}
            >
              <span className="inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border border-danger/60 bg-danger/10 font-mono text-[10px] font-bold text-danger">
                !
              </span>
              <span className="flex min-w-0 flex-1 flex-col leading-tight">
                <span className="truncate">
                  {name}
                  {dir && <span className="ml-1.5 text-xs text-muted">{dir}</span>}
                </span>
                <span className="truncate text-[11px] text-muted">{describeConflict(c.kind, names.ours, names.theirs)}</span>
              </span>
              <span className="hidden shrink-0 gap-1 group-hover:flex">
                <QuickPick
                  label="Current"
                  hint={`Keep the whole file from ${names.ours}`}
                  className="border-ok/40 text-ok hover:bg-ok/15"
                  disabled={!!busy}
                  onClick={() => resolveConflict(c.path, { side: 'ours' })}
                />
                <QuickPick
                  label="Incoming"
                  hint={`Keep the whole file from ${names.theirs}`}
                  className="border-accent/40 text-accent hover:bg-accent/15"
                  disabled={!!busy}
                  onClick={() => resolveConflict(c.path, { side: 'theirs' })}
                />
              </span>
            </li>
          )
        })}
      </ul>
    </section>
  )
}

function QuickPick({
  label,
  hint,
  className,
  disabled,
  onClick,
}: {
  label: string
  hint: string
  className: string
  disabled: boolean
  onClick: () => void
}) {
  return (
    <button
      disabled={disabled}
      title={hint}
      onClick={(e) => {
        e.stopPropagation()
        onClick()
      }}
      className={cx('h-6 rounded border px-1.5 text-[11px] font-medium disabled:opacity-50', className)}
    >
      {label}
    </button>
  )
}
