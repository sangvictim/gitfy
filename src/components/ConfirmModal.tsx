import { useState, type ReactNode } from 'react'
import { Button } from './Button'
import { Modal } from './Modal'

/** "Are you sure?" dialog; stays open (busy) while the action runs and closes when it succeeds */
export function ConfirmModal({
  title,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
  children,
}: {
  title: string
  confirmLabel: string
  danger?: boolean
  onConfirm: () => Promise<boolean>
  onClose: () => void
  children: ReactNode
}) {
  const [running, setRunning] = useState(false)
  const run = async () => {
    setRunning(true)
    const ok = await onConfirm()
    setRunning(false)
    if (ok) onClose()
  }
  return (
    <Modal
      title={title}
      onClose={onClose}
      footer={
        <>
          <Button variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button variant={danger ? 'danger' : 'primary'} autoFocus disabled={running} onClick={run}>
            {confirmLabel}
          </Button>
        </>
      }
    >
      {children}
    </Modal>
  )
}
