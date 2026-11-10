import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { cx } from '../lib/format'
import { Icon } from './Icon'

export type MenuEntry =
  | {
      label: string
      onClick?: () => void
      disabled?: boolean
      danger?: boolean
      /** Items shown in a submenu on hover */
      children?: MenuEntry[]
      hint?: string
    }
  | 'separator'

/** A right-click menu at (x, y), kept inside the window; closes on outside click, Esc, scroll or resize */
export function ContextMenu({ x, y, items, onClose }: { x: number; y: number; items: MenuEntry[]; onClose: () => void }) {
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const onDown = (e: MouseEvent) => !ref.current?.contains(e.target as Node) && onClose()
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose()
    window.addEventListener('mousedown', onDown)
    window.addEventListener('keydown', onKey)
    window.addEventListener('resize', onClose)
    window.addEventListener('wheel', onClose, { passive: true })
    window.addEventListener('blur', onClose)
    return () => {
      window.removeEventListener('mousedown', onDown)
      window.removeEventListener('keydown', onKey)
      window.removeEventListener('resize', onClose)
      window.removeEventListener('wheel', onClose)
      window.removeEventListener('blur', onClose)
    }
  }, [onClose])

  return createPortal(
    <div ref={ref} onContextMenu={(e) => e.preventDefault()}>
      <MenuList x={x} y={y} items={items} onClose={onClose} />
    </div>,
    document.body,
  )
}

function MenuList({
  x,
  y,
  items,
  onClose,
  alignRightOf,
}: {
  x: number
  y: number
  items: MenuEntry[]
  onClose: () => void
  /** For submenus: open to the left of this x if there is no room on the right */
  alignRightOf?: number
}) {
  const ref = useRef<HTMLUListElement>(null)
  const [pos, setPos] = useState({ x, y })
  const [open, setOpen] = useState<{ index: number; x: number; y: number; left: number } | null>(null)
  const timer = useRef<number | undefined>(undefined)

  // Keep the menu inside the window
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    const { width, height } = el.getBoundingClientRect()
    let nx = x
    if (nx + width > window.innerWidth - 4) nx = alignRightOf !== undefined ? alignRightOf - width : window.innerWidth - width - 4
    const ny = Math.max(4, Math.min(y, window.innerHeight - height - 4))
    setPos({ x: Math.max(4, nx), y: ny })
  }, [x, y, alignRightOf])

  return (
    <>
      <ul
        ref={ref}
        role="menu"
        style={{ left: pos.x, top: pos.y }}
        className="fixed z-50 max-h-[calc(100vh-8px)] min-w-56 overflow-y-auto rounded-md border border-border bg-panel-2 py-1 text-[12.5px] shadow-2xl"
      >
        {items.map((it, i) =>
          it === 'separator' ? (
            <li key={`sep-${i}`} role="separator" className="my-1 border-t border-border" />
          ) : (
            <li key={it.label}>
              <button
                role="menuitem"
                disabled={it.disabled}
                aria-haspopup={it.children ? 'menu' : undefined}
                aria-expanded={it.children ? open?.index === i : undefined}
                title={it.hint}
                onMouseEnter={(e) => {
                  window.clearTimeout(timer.current)
                  if (!it.children) return setOpen(null)
                  const r = e.currentTarget.getBoundingClientRect()
                  timer.current = window.setTimeout(() => setOpen({ index: i, x: r.right - 2, y: r.top - 4, left: r.left + 2 }), 80)
                }}
                onClick={() => {
                  if (it.children) {
                    const r = (document.activeElement as HTMLElement | null)?.getBoundingClientRect()
                    if (r) setOpen({ index: i, x: r.right - 2, y: r.top - 4, left: r.left + 2 })
                    return
                  }
                  // Run the action first: it may open a dialog that must survive the menu closing
                  it.onClick?.()
                  onClose()
                }}
                className={cx(
                  'flex w-full items-center gap-3 px-3 py-1.5 text-left hover:bg-bg disabled:opacity-40 disabled:hover:bg-transparent',
                  it.danger && 'text-danger',
                  open?.index === i && 'bg-bg',
                )}
              >
                <span className="min-w-0 flex-1 truncate">{it.label}</span>
                {it.children && <Icon name="chevron" size={12} className="shrink-0 text-muted" />}
              </button>
            </li>
          ),
        )}
      </ul>
      {open && items[open.index] !== 'separator' && (items[open.index] as { children?: MenuEntry[] }).children && (
        <MenuList
          x={open.x}
          y={open.y}
          alignRightOf={open.left}
          items={(items[open.index] as { children: MenuEntry[] }).children}
          onClose={onClose}
        />
      )}
    </>
  )
}
