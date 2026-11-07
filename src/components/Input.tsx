import { forwardRef, type InputHTMLAttributes, type TextareaHTMLAttributes } from 'react'
import { cx } from '../lib/format'

const base =
  'w-full rounded-md border border-border bg-bg px-2.5 text-[13px] text-fg placeholder:text-muted/70 outline-none focus:border-accent'

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  ({ className, ...rest }, ref) => <input ref={ref} {...rest} className={cx(base, 'h-8', className)} />,
)

export const TextArea = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  ({ className, ...rest }, ref) => (
    <textarea ref={ref} {...rest} className={cx(base, 'resize-none py-1.5', className)} />
  ),
)

export function Field({ label, hint, children }: { label: string; hint?: string; children: React.ReactNode }) {
  return (
    <label className="flex flex-col gap-1.5">
      <span className="text-xs font-medium text-muted">{label}</span>
      {children}
      {hint && <span className="text-[11px] text-muted/80">{hint}</span>}
    </label>
  )
}
