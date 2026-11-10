import { useEffect } from 'react'
import { Icon, type IconName } from '../../components/Icon'

/** Header bar of the full-width inspection views (history, blame, compare) */
export function ViewHeader({
  icon,
  title,
  info,
  actions = [],
  children,
  onClose,
}: {
  icon: IconName
  title: React.ReactNode
  info?: string
  actions?: { icon: IconName; label: string; title?: string; onClick: () => void }[]
  children?: React.ReactNode
  onClose: () => void
}) {
  useEffect(() => {
    // Esc closes the view — unless a dialog on top of it handles the key
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && !document.querySelector('[role=dialog]') && onClose()
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [onClose])

  return (
    <div className="flex h-10 shrink-0 items-center gap-2 border-b border-border px-3">
      <Icon name={icon} size={15} className="shrink-0 text-accent" />
      <div className="min-w-0 flex-1 truncate font-mono text-xs">{title}</div>
      {children}
      {info && <span className="shrink-0 rounded bg-panel-2 px-2 py-0.5 text-[11px] text-muted">{info}</span>}
      {actions.map((a) => (
        <button
          key={a.label}
          onClick={a.onClick}
          title={a.title ?? a.label}
          className="flex h-6 shrink-0 items-center gap-1 rounded px-1.5 text-[11px] text-muted hover:bg-panel-2 hover:text-fg"
        >
          <Icon name={a.icon} size={12} /> {a.label}
        </button>
      ))}
      <button
        onClick={onClose}
        className="rounded p-1 text-muted hover:bg-panel-2 hover:text-fg"
        title="Close (Esc)"
        aria-label="Close"
      >
        <Icon name="x" size={14} />
      </button>
    </div>
  )
}
