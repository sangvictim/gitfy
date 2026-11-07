import type { ButtonHTMLAttributes } from 'react'
import { cx } from '../lib/format'

type Variant = 'primary' | 'secondary' | 'ghost' | 'danger'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: Variant
  size?: 'sm' | 'md'
}

const variants: Record<Variant, string> = {
  primary: 'bg-accent text-white hover:bg-accent-strong',
  secondary: 'bg-panel-2 text-fg border border-border hover:bg-[#232836]',
  ghost: 'text-muted hover:text-fg hover:bg-panel-2',
  danger: 'bg-danger/90 text-white hover:bg-danger',
}

export function Button({ variant = 'secondary', size = 'md', className, ...rest }: Props) {
  return (
    <button
      {...rest}
      className={cx(
        'inline-flex items-center justify-center gap-1.5 rounded-md font-medium transition-colors',
        'disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-2 focus-visible:outline-accent',
        size === 'sm' ? 'h-7 px-2 text-xs' : 'h-8 px-3 text-[13px]',
        variants[variant],
        className,
      )}
    />
  )
}
