import { cx } from '../lib/format'

const map: Record<string, { letter: string; cls: string; label: string }> = {
  modified: { letter: 'M', cls: 'text-warn border-warn/40', label: 'Modified' },
  added: { letter: 'A', cls: 'text-ok border-ok/40', label: 'Added' },
  untracked: { letter: 'U', cls: 'text-ok border-ok/40', label: 'Untracked' },
  deleted: { letter: 'D', cls: 'text-danger border-danger/40', label: 'Deleted' },
  renamed: { letter: 'R', cls: 'text-accent border-accent/40', label: 'Renamed' },
  typechange: { letter: 'T', cls: 'text-accent border-accent/40', label: 'Type changed' },
  conflicted: { letter: '!', cls: 'text-danger border-danger/60 bg-danger/10', label: 'Conflicted' },
  // single-letter codes from git diff --name-status
  M: { letter: 'M', cls: 'text-warn border-warn/40', label: 'Modified' },
  A: { letter: 'A', cls: 'text-ok border-ok/40', label: 'Added' },
  D: { letter: 'D', cls: 'text-danger border-danger/40', label: 'Deleted' },
  R: { letter: 'R', cls: 'text-accent border-accent/40', label: 'Renamed' },
  C: { letter: 'C', cls: 'text-accent border-accent/40', label: 'Copied' },
  T: { letter: 'T', cls: 'text-accent border-accent/40', label: 'Type changed' },
}

export function FileStatusBadge({ type }: { type: string }) {
  const m = map[type] ?? { letter: '?', cls: 'text-muted border-border', label: type }
  return (
    <span
      title={m.label}
      className={cx(
        'inline-flex h-4 w-4 shrink-0 items-center justify-center rounded border font-mono text-[10px] font-bold',
        m.cls,
      )}
    >
      {m.letter}
    </span>
  )
}
