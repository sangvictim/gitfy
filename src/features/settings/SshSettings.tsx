import { useCallback, useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { cx } from '../../lib/format'
import { ipc } from '../../services/ipc'
import { toast } from '../../store/toast.store'
import type { Settings, SshKeyInfo, SshTestResult } from '../../types/git'

const HOSTS = ['github.com', 'gitlab.com', 'bitbucket.org'] as const

/** SSH key used by fetch / pull / push / clone in every repository */
export function SshSettingsSection() {
  const [settings, setSettings] = useState<Settings | null>(null)
  const [info, setInfo] = useState<SshKeyInfo | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [host, setHost] = useState<(typeof HOSTS)[number]>('github.com')
  const [test, setTest] = useState<SshTestResult | null>(null)

  const refreshInfo = useCallback(() => {
    ipc.sshKeyInfo().then(setInfo).catch(() => setInfo(null))
  }, [])

  useEffect(() => {
    ipc.getSettings().then(setSettings).catch((e) => toast.error(e.message))
    refreshInfo()
  }, [refreshInfo])

  /** Run a settings action, then refresh what's shown */
  const act = async (label: string, fn: () => Promise<Settings | void>) => {
    setBusy(label)
    setTest(null)
    try {
      const next = await fn()
      if (next) setSettings(next)
      refreshInfo()
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    } finally {
      setBusy(null)
    }
  }

  const copyPublicKey = async () => {
    try {
      await navigator.clipboard.writeText(await ipc.readSshPublicKey())
      toast.success('Public key copied to the clipboard')
    } catch (e) {
      toast.error(e instanceof Error ? e.message : String(e))
    }
  }

  if (!settings) return <p className="text-muted">Loading…</p>
  const ssh = settings.ssh
  const keyDisabled = ssh.useAgent || !!busy

  return (
    <div className="grid max-w-[900px] grid-cols-[260px_minmax(0,1fr)] items-start gap-x-8 gap-y-6">
      {/* Use local SSH agent */}
      <Label htmlFor="ssh-agent">Use local SSH agent</Label>
      <div>
        <input
          id="ssh-agent"
          type="checkbox"
          className="mt-2 h-4 w-4 accent-[var(--color-accent)]"
          checked={ssh.useAgent}
          disabled={!!busy}
          onChange={(e) => act('agent', () => ipc.setSshAgent(e.target.checked))}
        />
        <Hint>Use the keys loaded in your system ssh-agent (ssh-add) instead of the key file below.</Hint>
      </div>

      {/* Private key */}
      <Label>SSH Private Key</Label>
      <div className={cx(ssh.useAgent && 'opacity-50')}>
        <div className="flex min-w-0 items-center gap-3">
          <BrowseButton disabled={keyDisabled} onClick={() => act('browse', () => ipc.browseSshKey('private'))} />
          <Path value={ssh.privateKey} />
        </div>
        {!ssh.useAgent && <KeyStatus info={info} />}
      </div>

      {/* Public key */}
      <Label>SSH Public Key</Label>
      <div className={cx('flex min-w-0 items-center gap-3', ssh.useAgent && 'opacity-50')}>
        <BrowseButton disabled={keyDisabled} onClick={() => act('browse', () => ipc.browseSshKey('public'))} />
        <Path value={ssh.publicKey} />
        {ssh.publicKey && (
          <button
            onClick={copyPublicKey}
            className="shrink-0 rounded border border-border p-1.5 text-muted hover:border-accent hover:text-fg"
            title="Copy public key (to add it to GitHub / GitLab)"
            aria-label="Copy public key"
          >
            <Icon name="copy" size={15} />
          </button>
        )}
      </div>

      {/* Generate */}
      <Label>Generate new Private/Public key</Label>
      <div>
        <button
          disabled={!!busy}
          onClick={() =>
            act('generate', async () => {
              const r = await ipc.generateSshKey()
              await navigator.clipboard.writeText(r.publicKey).catch(() => {})
              toast.success('New SSH key created and selected. Its public key was copied — add it to your Git host (e.g. GitHub → Settings → SSH and GPG keys).')
              return r.settings
            })
          }
          className="h-8 rounded border border-ok/50 bg-ok/10 px-4 text-[13px] text-ok hover:bg-ok/20 disabled:opacity-50"
        >
          {busy === 'generate' ? 'Generating…' : 'Generate'}
        </button>
        <Hint>
          Creates a new ED25519 key pair without a passphrase in Gitfy&apos;s data folder and configures Gitfy to use it.
          Your existing keys in ~/.ssh are not touched.
        </Hint>
      </div>

      {/* Test */}
      <Label>Test connection</Label>
      <div>
        <div className="flex items-center gap-2">
          <select
            value={host}
            onChange={(e) => setHost(e.target.value as (typeof HOSTS)[number])}
            className="h-8 rounded border border-border bg-bg px-2 text-[13px] outline-none focus:border-accent"
            aria-label="Git host"
          >
            {HOSTS.map((h) => (
              <option key={h}>{h}</option>
            ))}
          </select>
          <button
            disabled={!!busy}
            onClick={async () => {
              setBusy('test')
              setTest(null)
              try {
                setTest(await ipc.testSsh(host))
              } catch (e) {
                setTest({ ok: false, message: e instanceof Error ? e.message : String(e) })
              } finally {
                setBusy(null)
              }
            }}
            className="h-8 rounded border border-accent/60 bg-accent/10 px-4 text-[13px] text-fg hover:bg-accent/20 disabled:opacity-50"
          >
            {busy === 'test' ? 'Testing…' : 'Test'}
          </button>
        </div>
        {test && (
          <p className={cx('mt-2 flex items-start gap-1.5 text-xs whitespace-pre-wrap', test.ok ? 'text-ok' : 'text-danger')}>
            <Icon name={test.ok ? 'check' : 'alert'} size={14} className="mt-px shrink-0" />
            <span className="selectable">{test.message}</span>
          </p>
        )}
        <Hint>Checks that the current settings can authenticate over SSH. Nothing is changed on the server.</Hint>
      </div>

      <div />
      <p className="text-xs text-muted">
        These settings are global: fetch, pull, push and clone use them in every repository.
      </p>
    </div>
  )
}

function KeyStatus({ info }: { info: SshKeyInfo | null }) {
  if (!info) return null
  const line = (ok: boolean, text: string) => (
    <p className={cx('mt-2 flex items-center gap-1.5 text-xs', ok ? 'text-ok' : 'text-warn')}>
      <Icon name={ok ? 'check' : 'alert'} size={13} className="shrink-0" />
      {text}
    </p>
  )
  switch (info.status) {
    case 'ok':
      return (
        <>
          {line(true, `${info.type ?? 'SSH'} key · ${info.fingerprint ?? ''}`)}
          {info.mismatch && line(false, 'The selected public key does not belong to this private key')}
        </>
      )
    case 'passphrase':
      return line(true, 'Protected by a passphrase — Gitfy asks for it when pull, push, fetch or clone needs it')
    case 'missing':
      return line(false, 'The key file no longer exists')
    case 'invalid':
      return line(false, `Not a valid SSH private key${info.detail ? ` (${info.detail})` : ''}`)
    case 'none':
      return line(false, 'No key selected — git will use your default SSH configuration')
    default:
      return info.detail ? line(false, info.detail) : null
  }
}

function Label({ children, htmlFor }: { children: React.ReactNode; htmlFor?: string }) {
  return (
    <label htmlFor={htmlFor} className="pt-1.5 text-right text-[14px] text-fg/90">
      {children}
    </label>
  )
}

function Hint({ children }: { children: React.ReactNode }) {
  return <p className="mt-2 max-w-[560px] text-xs text-muted">{children}</p>
}

function BrowseButton({ onClick, disabled }: { onClick: () => void; disabled?: boolean }) {
  return (
    <button
      onClick={onClick}
      disabled={disabled}
      className="h-8 shrink-0 rounded border border-accent/60 bg-accent/15 px-3.5 text-[13px] text-fg hover:bg-accent/25 disabled:pointer-events-none"
    >
      Browse
    </button>
  )
}

function Path({ value }: { value: string | null }) {
  return (
    <span className={cx('selectable min-w-0 truncate font-mono text-[13px]', !value && 'text-muted')} title={value ?? undefined}>
      {value ?? 'Not selected'}
    </span>
  )
}
