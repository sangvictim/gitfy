import { useEffect, useRef, useState } from 'react'
import type { AskpassRequest } from '../types/git'
import { Button } from './Button'
import { Icon } from './Icon'
import { Modal } from './Modal'

const TITLES: Record<AskpassRequest['kind'], string> = {
  passphrase: 'SSH key passphrase',
  password: 'Password required',
  username: 'Username required',
  confirm: 'Confirm',
  text: 'Git needs your input',
}

/** Key file named in an ssh prompt: "Enter passphrase for key '/home/me/.ssh/id_rsa': " */
const keyFromPrompt = (prompt: string) => /for key '([^']+)'/.exec(prompt)?.[1]

/**
 * Answers ssh / git prompts (SSH key passphrase, HTTPS username / password) so the user never has
 * to switch to a terminal. Requests are queued and answered one at a time.
 */
export function AskpassDialog() {
  const [queue, setQueue] = useState<AskpassRequest[]>([])
  const [value, setValue] = useState('')
  const [reveal, setReveal] = useState(false)
  const [remember, setRemember] = useState(true)
  const inputRef = useRef<HTMLInputElement>(null)
  const req = queue[0]

  useEffect(() => window.gitfy.askpass.onRequest((r) => setQueue((q) => [...q, r])), [])

  useEffect(() => {
    setValue('')
    setReveal(false)
    if (req) requestAnimationFrame(() => inputRef.current?.focus())
  }, [req])

  if (!req) return null

  const secret = req.kind === 'passphrase' || req.kind === 'password'
  const respond = (answer: string | null) => {
    window.gitfy.askpass.reply(req.id, answer, secret && remember)
    setQueue((q) => q.slice(1))
  }
  const keyFile = keyFromPrompt(req.prompt)

  return (
    <Modal
      title={TITLES[req.kind]}
      onClose={() => respond(null)}
      footer={
        <>
          <Button variant="ghost" onClick={() => respond(null)}>
            Cancel
          </Button>
          <Button variant="primary" disabled={secret && !value} onClick={() => respond(value)}>
            OK
          </Button>
        </>
      }
    >
      <form
        className="flex flex-col gap-3"
        onSubmit={(e) => {
          e.preventDefault()
          if (!secret || value) respond(value)
        }}
      >
        <div className="flex items-start gap-3">
          <span className="rounded-md bg-accent/15 p-2 text-accent">
            <Icon name={req.kind === 'passphrase' ? 'key' : 'shield'} size={18} />
          </span>
          <div className="min-w-0 text-[13px]">
            {keyFile ? (
              <>
                <p>Enter the passphrase for your SSH key:</p>
                <p className="selectable mt-1 truncate font-mono text-xs text-muted" title={keyFile}>
                  {keyFile}
                </p>
              </>
            ) : (
              <p className="selectable break-words">{req.prompt}</p>
            )}
          </div>
        </div>

        {req.retry && (
          <p className="flex items-center gap-1.5 rounded border border-danger/40 bg-danger/10 px-2.5 py-1.5 text-xs text-danger">
            <Icon name="alert" size={13} />
            Incorrect {req.kind === 'passphrase' ? 'passphrase' : 'answer'} — please try again.
          </p>
        )}

        <div className="relative">
          <input
            ref={inputRef}
            type={secret && !reveal ? 'password' : 'text'}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            autoComplete="off"
            spellCheck={false}
            aria-label={TITLES[req.kind]}
            placeholder={req.kind === 'confirm' ? 'yes / no' : undefined}
            className="h-9 w-full rounded-md border border-border bg-bg pr-9 pl-2.5 text-[13px] outline-none focus:border-accent"
          />
          {secret && (
            <button
              type="button"
              onClick={() => setReveal(!reveal)}
              className="absolute top-1/2 right-1.5 -translate-y-1/2 rounded px-1.5 py-0.5 text-[11px] text-muted hover:text-fg"
              aria-label={reveal ? 'Hide' : 'Show'}
            >
              {reveal ? 'Hide' : 'Show'}
            </button>
          )}
        </div>

        {secret && (
          <label className="flex items-center gap-2 text-[13px]">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            Remember for this session
            <span className="text-xs text-muted">(kept in memory until Gitfy closes, never saved to disk)</span>
          </label>
        )}
        <button type="submit" hidden />
      </form>
    </Modal>
  )
}
