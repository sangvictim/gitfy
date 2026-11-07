import { app, dialog, type BrowserWindow } from 'electron'
import { execFile } from 'node:child_process'
import fs from 'node:fs/promises'
import os from 'node:os'
import path from 'node:path'
import type { Settings, SshKeyInfo, SshSettings, SshTestResult } from '../../src/types/git'
import { askpass } from './askpass.service'

const DEFAULTS: Settings = {
  ssh: { useAgent: false, privateKey: null, publicKey: null },
}

/** Run a program without a shell; resolves with exit code + output instead of throwing */
function run(
  file: string,
  args: string[],
  timeoutMs = 20000,
  extraEnv: Record<string, string> = {},
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    execFile(file, args, { timeout: timeoutMs, env: { ...process.env, ...extraEnv } }, (err, stdout, stderr) => {
      // err.code is the exit status (number), or a string such as 'ENOENT' when the program is missing
      const raw = (err as { code?: number | string } | null)?.code
      const code = !err ? 0 : raw === 'ENOENT' ? 127 : typeof raw === 'number' ? raw : 1
      resolve({ code, stdout: String(stdout), stderr: String(stderr) })
    })
  })
}

const exists = (p: string) =>
  fs
    .stat(p)
    .then((s) => s.isFile())
    .catch(() => false)

/** Single-quote for the shell that git uses to run GIT_SSH_COMMAND */
const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

/**
 * Global application settings (all tabs / repositories), stored as settings.json in the
 * user data folder. Key paths can only be set through the native file dialog or by generating
 * a key — the renderer never passes arbitrary paths.
 */
class SettingsService {
  private settings: Settings = structuredClone(DEFAULTS)

  private get file() {
    return path.join(app.getPath('userData'), 'settings.json')
  }

  async load() {
    try {
      const data = JSON.parse(await fs.readFile(this.file, 'utf8'))
      const ssh = data?.ssh ?? {}
      this.settings = {
        ssh: {
          useAgent: ssh.useAgent === true,
          privateKey: typeof ssh.privateKey === 'string' ? ssh.privateKey : null,
          publicKey: typeof ssh.publicKey === 'string' ? ssh.publicKey : null,
        },
      }
    } catch {
      this.settings = structuredClone(DEFAULTS)
      // First run: suggest the user's usual key if there is one
      for (const name of ['id_ed25519', 'id_rsa', 'id_ecdsa']) {
        const p = path.join(os.homedir(), '.ssh', name)
        if (await exists(p)) {
          this.settings.ssh.privateKey = p
          this.settings.ssh.publicKey = (await exists(`${p}.pub`)) ? `${p}.pub` : null
          break
        }
      }
    }
  }

  get(): Settings {
    return structuredClone(this.settings)
  }

  private async save() {
    await fs.mkdir(path.dirname(this.file), { recursive: true })
    await fs.writeFile(this.file, JSON.stringify(this.settings, null, 2))
  }

  private async updateSsh(partial: Partial<SshSettings>) {
    this.settings.ssh = { ...this.settings.ssh, ...partial }
    await this.save()
    return this.get()
  }

  setUseAgent(useAgent: boolean) {
    return this.updateSsh({ useAgent: useAgent === true })
  }

  /** Pick a key file with the native dialog. Choosing a private key also picks up its .pub next to it. */
  async browseKey(win: BrowserWindow | null, kind: 'private' | 'public'): Promise<Settings> {
    const options = {
      title: kind === 'private' ? 'Select SSH private key' : 'Select SSH public key',
      defaultPath: path.join(os.homedir(), '.ssh'),
      properties: ['openFile', 'showHiddenFiles'] as ('openFile' | 'showHiddenFiles')[],
      filters: kind === 'public' ? [{ name: 'Public keys', extensions: ['pub'] }, { name: 'All files', extensions: ['*'] }] : undefined,
    }
    const res = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
    if (res.canceled || !res.filePaths[0]) return this.get()
    const file = res.filePaths[0]
    if (kind === 'public') return this.updateSsh({ publicKey: file })
    const pub = (await exists(`${file}.pub`)) ? `${file}.pub` : this.settings.ssh.publicKey
    return this.updateSsh({ privateKey: file, publicKey: pub })
  }

  /** Create a new ED25519 key pair (no passphrase) in Gitfy's data folder and start using it */
  async generateKey(): Promise<{ settings: Settings; publicKey: string }> {
    const dir = path.join(app.getPath('userData'), 'ssh')
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    let file = path.join(dir, 'gitfy_ed25519')
    if (await exists(file)) file = path.join(dir, `gitfy_ed25519_${new Date().toISOString().replace(/[-:T]/g, '').slice(0, 14)}`)
    const comment = `gitfy@${os.hostname()}`
    const r = await run('ssh-keygen', ['-t', 'ed25519', '-N', '', '-C', comment, '-f', file, '-q'])
    if (r.code === 127) throw new Error('ssh-keygen was not found. Install OpenSSH (openssh-client) to generate keys.')
    if (r.code !== 0) throw new Error(`ssh-keygen failed: ${r.stderr.trim() || r.stdout.trim()}`)
    await fs.chmod(file, 0o600)
    const settings = await this.updateSsh({ privateKey: file, publicKey: `${file}.pub`, useAgent: false })
    return { settings, publicKey: (await fs.readFile(`${file}.pub`, 'utf8')).trim() }
  }

  /** Text of the configured public key (for copying to GitHub / GitLab) */
  async readPublicKey(): Promise<string> {
    const p = this.settings.ssh.publicKey
    if (!p) throw new Error('No SSH public key is selected')
    const stat = await fs.stat(p).catch(() => null)
    if (!stat?.isFile()) throw new Error(`Public key not found: ${p}`)
    if (stat.size > 16 * 1024) throw new Error('That file is too large to be an SSH public key')
    const text = (await fs.readFile(p, 'utf8')).trim()
    if (/PRIVATE KEY/.test(text)) throw new Error('That file is a private key — select the .pub file')
    return text
  }

  /** Inspect the configured key: usable, passphrase-protected, missing… and whether the .pub matches */
  async keyInfo(): Promise<SshKeyInfo> {
    const { privateKey, publicKey } = this.settings.ssh
    if (!privateKey) return { status: 'none' }
    if (!(await exists(privateKey))) return { status: 'missing' }
    const derived = await run('ssh-keygen', ['-y', '-P', '', '-f', privateKey])
    if (derived.code === 127) return { status: 'unknown', detail: 'ssh-keygen not found' }
    if (derived.code !== 0) {
      const msg = derived.stderr + derived.stdout
      if (/passphrase|incorrect/i.test(msg)) return { status: 'passphrase' }
      return { status: 'invalid', detail: msg.trim().split('\n')[0] }
    }
    const pubFromPrivate = derived.stdout.trim()
    // Fingerprint & type from the public half (ssh-keygen -l needs a file)
    let type: string | undefined
    let fingerprint: string | undefined
    const tmp = path.join(os.tmpdir(), `gitfy-pub-${process.pid}-${Date.now()}.pub`)
    try {
      await fs.writeFile(tmp, pubFromPrivate + '\n', { mode: 0o600 })
      const l = await run('ssh-keygen', ['-l', '-f', tmp])
      const m = /^(\d+)\s+(\S+)\s+.*\((\w+)\)\s*$/.exec(l.stdout.trim())
      if (m) {
        fingerprint = m[2]
        type = m[3]
      }
    } finally {
      await fs.rm(tmp, { force: true })
    }
    let mismatch = false
    if (publicKey && (await exists(publicKey))) {
      const pub = (await fs.readFile(publicKey, 'utf8')).trim().split(/\s+/).slice(0, 2).join(' ')
      mismatch = pub !== pubFromPrivate.split(/\s+/).slice(0, 2).join(' ')
    }
    return { status: 'ok', type, fingerprint, mismatch }
  }

  /**
   * GIT_SSH_COMMAND for network git commands. There is no terminal: passphrases are asked through
   * Gitfy's askpass dialog; new hosts are accepted on first use, changed host keys are still rejected.
   */
  sshCommand(): string {
    const parts = ['ssh', '-o StrictHostKeyChecking=accept-new', '-o ConnectTimeout=20']
    const { useAgent, privateKey } = this.settings.ssh
    if (!useAgent && privateKey) parts.push(`-i ${shQuote(privateKey)}`, '-o IdentitiesOnly=yes')
    return parts.join(' ')
  }

  /** Try to authenticate to a Git host with the current settings (`ssh -T git@github.com`) */
  async testSsh(host = 'github.com'): Promise<SshTestResult> {
    const { useAgent, privateKey } = this.settings.ssh
    const args = ['-T', '-o', 'StrictHostKeyChecking=accept-new', '-o', 'ConnectTimeout=15']
    if (!useAgent && privateKey) args.push('-i', privateKey, '-o', 'IdentitiesOnly=yes')
    args.push(`git@${host}`)
    // Passphrase-protected keys are unlocked through the askpass dialog; allow time to type it
    const r = await run('ssh', args, 5 * 60_000, askpass.env())
    if (r.code === 127) return { ok: false, message: 'ssh was not found. Install OpenSSH (openssh-client).' }
    const out = (r.stdout + '\n' + r.stderr).trim()
    // GitHub answers "Hi <user>! You've successfully authenticated…" (exit 1, no shell access)
    if (r.code !== 0 && askpass.consumeCancelled()) return { ok: false, message: 'Cancelled — no passphrase was entered.' }
    if (/successfully authenticated|Welcome to GitLab|authenticated via/i.test(out)) {
      return { ok: true, message: out.split('\n').find((l) => /authenticated|Welcome/i.test(l))?.trim() ?? out }
    }
    return { ok: false, message: out.split('\n').filter(Boolean).slice(-2).join('\n') || `ssh exited with code ${r.code}` }
  }
}

export const settingsService = new SettingsService()
