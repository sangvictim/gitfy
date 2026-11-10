import { FileStatusBadge } from '../../components/FileStatusBadge'
import { Icon } from '../../components/Icon'
import { cx, splitPath } from '../../lib/format'
import type { FileChange } from '../../types/git'

interface Props {
  title: string
  files: FileChange[]
  staged: boolean
  selectedPath: string | null
  onSelect: (f: FileChange) => void
  onToggle: (f: FileChange) => void
  onToggleAll: () => void
  /** Offer "discard changes" (unstaged list only) */
  onDiscard?: (files: FileChange[]) => void
  /** Offer "add to .gitignore" for untracked files */
  onIgnore?: (file: FileChange) => void
}

export function FileList({ title, files, staged, selectedPath, onSelect, onToggle, onToggleAll, onDiscard, onIgnore }: Props) {
  const actionLabel = staged ? 'Unstage' : 'Stage'
  return (
    <section className="flex min-h-0 flex-1 flex-col">
      <header className="flex h-8 shrink-0 items-center gap-2 border-b border-border bg-panel px-3">
        <span className="text-xs font-semibold tracking-wide text-muted uppercase">{title}</span>
        <span className="rounded-full bg-panel-2 px-1.5 text-[11px] text-muted">{files.length}</span>
        <div className="flex-1" />
        {files.length > 0 && onDiscard && (
          <button
            onClick={() => onDiscard(files)}
            title="Discard all unstaged changes"
            className="h-6 rounded border border-border px-2 text-[11px] font-medium text-muted hover:border-danger/40 hover:text-danger"
          >
            Discard all
          </button>
        )}
        {files.length > 0 && (
          <button
            onClick={onToggleAll}
            className={cx(
              'h-6 rounded border px-2 text-[11px] font-medium',
              staged ? 'border-danger/40 text-danger hover:bg-danger/10' : 'border-ok/40 text-ok hover:bg-ok/10',
            )}
          >
            {staged ? 'Unstage all' : 'Stage all changes'}
          </button>
        )}
      </header>
      <ul className="min-h-0 flex-1 overflow-y-auto py-1" role="listbox" aria-label={title}>
        {files.length === 0 && (
          <li className="px-3 py-3 text-xs text-muted">{staged ? 'No staged changes' : 'Working tree clean'}</li>
        )}
        {files.map((f) => {
          const { dir, name } = splitPath(f.path)
          const selected = selectedPath === f.path
          return (
            <li
              key={f.path}
              role="option"
              aria-selected={selected}
              onClick={() => onSelect(f)}
              onDoubleClick={() => onToggle(f)}
              title={f.from ? `${f.from} → ${f.path}` : f.path}
              className={cx(
                'group flex h-7 cursor-default items-center gap-2 px-3',
                selected ? 'bg-accent/20' : 'hover:bg-panel-2',
              )}
            >
              <FileStatusBadge type={f.type} />
              <span className="min-w-0 flex-1 truncate">
                <span className={cx(f.type === 'deleted' && 'line-through opacity-70')}>{name}</span>
                {dir && <span className="ml-1.5 text-xs text-muted">{dir}</span>}
              </span>
              {onIgnore && f.type === 'untracked' && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onIgnore(f)
                  }}
                  title="Add to .gitignore"
                  aria-label={`Ignore ${f.path}`}
                  className="rounded p-0.5 text-muted opacity-0 group-hover:opacity-100 hover:bg-bg hover:text-fg"
                >
                  <Icon name="ignore" size={13} />
                </button>
              )}
              {onDiscard && (
                <button
                  onClick={(e) => {
                    e.stopPropagation()
                    onDiscard([f])
                  }}
                  title={f.type === 'untracked' ? 'Delete this new file' : 'Discard changes'}
                  aria-label={`Discard changes to ${f.path}`}
                  className="rounded p-0.5 text-muted opacity-0 group-hover:opacity-100 hover:bg-bg hover:text-danger"
                >
                  <Icon name="trash" size={13} />
                </button>
              )}
              <button
                onClick={(e) => {
                  e.stopPropagation()
                  onToggle(f)
                }}
                title={actionLabel}
                aria-label={`${actionLabel} ${f.path}`}
                className="rounded p-0.5 text-muted opacity-0 group-hover:opacity-100 hover:bg-bg hover:text-fg"
              >
                <Icon name={staged ? 'minus' : 'plus'} size={14} />
              </button>
            </li>
          )
        })}
      </ul>
    </section>
  )
}
