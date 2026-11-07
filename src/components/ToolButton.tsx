import { Icon, type IconName } from './Icon'

/** Toolbar button with the icon above its label */
export function ToolButton({
  icon,
  label,
  onClick,
  spin,
  disabled,
  title,
  badge,
}: {
  icon: IconName
  label: string
  onClick: () => void
  spin?: boolean
  disabled?: boolean
  /** Tooltip (defaults to the label) */
  title?: string
  /** Small counter shown at the icon's top-right (e.g. commits to pull / push) */
  badge?: number
}) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      title={title ?? label}
      aria-label={title ?? label}
      className="relative flex w-14 flex-col items-center gap-0.5 rounded-md py-1 text-muted hover:bg-panel-2 hover:text-fg disabled:pointer-events-none disabled:opacity-35"
    >
      <Icon name={icon} size={18} className={spin ? 'animate-spin' : undefined} />
      <span className="text-[10.5px]">{label}</span>
      {!!badge && (
        <span className="absolute top-0 right-1.5 min-w-4 rounded-full bg-accent px-1 text-center text-[9.5px] leading-4 font-semibold text-white tabular-nums">
          {badge > 99 ? '99+' : badge}
        </span>
      )}
    </button>
  )
}
