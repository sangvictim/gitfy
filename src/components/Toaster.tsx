import { useToastStore } from '../store/toast.store'
import { cx } from '../lib/format'
import { Icon } from './Icon'

export function Toaster() {
  const { toasts, dismiss } = useToastStore()
  return (
    <div className="pointer-events-none fixed right-4 bottom-4 z-50 flex w-[380px] max-w-[calc(100vw-2rem)] flex-col gap-2">
      {toasts.map((t) => (
        <div
          key={t.id}
          role={t.kind === 'error' ? 'alert' : 'status'}
          className={cx(
            'pointer-events-auto flex items-start gap-2 rounded-md border bg-panel-2 px-3 py-2.5 shadow-lg',
            t.kind === 'error' && 'border-danger/50',
            t.kind === 'success' && 'border-ok/40',
            t.kind === 'info' && 'border-border',
          )}
        >
          <Icon
            name={t.kind === 'error' ? 'alert' : t.kind === 'success' ? 'check' : 'info'}
            className={cx(
              'mt-0.5 shrink-0',
              t.kind === 'error' ? 'text-danger' : t.kind === 'success' ? 'text-ok' : 'text-accent',
            )}
          />
          <p className="selectable flex-1 text-[12.5px] break-words whitespace-pre-wrap">{t.message}</p>
          <button onClick={() => dismiss(t.id)} className="text-muted hover:text-fg" aria-label="Dismiss">
            <Icon name="x" size={14} />
          </button>
        </div>
      ))}
    </div>
  )
}
