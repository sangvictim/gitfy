import { app } from 'electron'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import fs from 'node:fs/promises'
import net from 'node:net'
import os from 'node:os'
import path from 'node:path'
import type { AskpassRequest } from '../../src/types/git'

/**
 * Lets ssh (key passphrases) and git (HTTPS username / password) ask the user through a Gitfy
 * dialog instead of a terminal.
 *
 * ssh / git run SSH_ASKPASS — a tiny helper script — with the prompt as argument. The helper
 * forwards it over a private unix socket (mode 0600, random token) to this service, which asks
 * the renderer to show a dialog and sends the answer back for the helper to print on stdout.
 * Answers are only ever held in memory ("remember for this session"); nothing is written to disk.
 */

/** Runs under the Electron binary in Node mode (ELECTRON_RUN_AS_NODE=1); kept dependency-free */
const HELPER_JS = `'use strict'
const net = require('net')
const sock = process.env.GITFY_ASKPASS_SOCK
const token = process.env.GITFY_ASKPASS_TOKEN
const prompt = process.argv.slice(2).join(' ')
if (!sock || !token) process.exit(1)
// ppid = the ssh / git process asking (the sh wrapper exec()s into this script)
const c = net.connect(sock, () => c.write(JSON.stringify({ token, prompt, asker: process.ppid }) + '\\n'))
let buf = ''
c.setEncoding('utf8')
c.on('data', (d) => {
  buf += d
  const i = buf.indexOf('\\n')
  if (i < 0) return
  let r
  try { r = JSON.parse(buf.slice(0, i)) } catch { process.exit(1) }
  c.end()
  if (r && r.ok && typeof r.value === 'string') { process.stdout.write(r.value + '\\n'); process.exit(0) }
  // Marks this command's failure as a cancel (read by Gitfy from git's error output)
  process.stderr.write('gitfy-askpass: cancelled\\n')
  process.exit(1)
})
c.on('error', (e) => { process.stderr.write('gitfy-askpass: unreachable (' + (e && e.code) + ')\\n'); process.exit(1) })
setTimeout(() => process.exit(1), 10 * 60 * 1000).unref()
`

const shQuote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`

type Asker = (req: AskpassRequest) => Promise<{ value: string | null; remember: boolean }>
/** Withdraw a request whose ssh / git process went away (timed out, killed) before it was answered */
type Dismisser = (id: number) => void


class AskpassService {
  private socketPath = ''
  private token = ''
  private scriptPath = ''
  private server: net.Server | null = null
  private asker: Asker | null = null
  private dismiss: Dismisser | null = null
  private nextId = 1
  /** "Remember for this session" answers, keyed by prompt (e.g. the key file in the prompt) */
  private remembered = new Map<string, { value: string; kind: AskpassRequest['kind'] }>()
  /** Which process each prompt was last answered for: the same process asking again = wrong answer */
  private answeredFor = new Map<string, number>()

  /** Write the helper and start listening. Call once at startup. */
  async start() {
    const dir = path.join(app.getPath('userData'), 'askpass')
    await fs.mkdir(dir, { recursive: true, mode: 0o700 })
    /** Gitfy processes that are no longer running (crashed): their files can go */
    const dead = (pid: number) => {
      if (!pid || pid === process.pid) return false
      try {
        process.kill(pid, 0)
        return false
      } catch (err) {
        return (err as NodeJS.ErrnoException).code === 'ESRCH'
      }
    }
    // Leftovers of crashed instances
    for (const name of await fs.readdir(dir).catch(() => [] as string[])) {
      if (dead(Number(/^askpass-(\d+)-[0-9a-f]+\.(sh|cjs)$/.exec(name)?.[1]))) {
        await fs.rm(path.join(dir, name), { force: true }).catch(() => {})
      }
    }
    for (const name of await fs.readdir(os.tmpdir()).catch(() => [] as string[])) {
      if (dead(Number(/^gitfy-askpass-(\d+)-[0-9a-f]+\.sock$/.exec(name)?.[1]))) {
        await fs.rm(path.join(os.tmpdir(), name), { force: true }).catch(() => {})
      }
    }

    // One helper + script per running instance: process.execPath is only valid while this instance
    // runs (an AppImage's is a temporary mount), so a shared script would break when another
    // instance — e.g. a newer version opened once — rewrites it and then quits
    const id = `${process.pid}-${randomBytes(4).toString('hex')}`
    const helper = path.join(dir, `askpass-${id}.cjs`)
    await fs.writeFile(helper, HELPER_JS, { mode: 0o600 })
    this.scriptPath = path.join(dir, `askpass-${id}.sh`)
    await fs.writeFile(
      this.scriptPath,
      `#!/bin/sh\nELECTRON_RUN_AS_NODE=1 exec ${shQuote(process.execPath)} ${shQuote(helper)} "$@"\n`,
      { mode: 0o700 },
    )
    await fs.chmod(this.scriptPath, 0o700)

    this.token = randomBytes(32).toString('hex')
    // Windows: a named pipe. Elsewhere a short path in the temp dir (unix socket paths are limited
    // to ~100 characters)
    const win = process.platform === 'win32'
    this.socketPath = win ? `\\\\.\\pipe\\gitfy-askpass-${id}` : path.join(os.tmpdir(), `gitfy-askpass-${id}.sock`)
    if (!win) await fs.rm(this.socketPath, { force: true })
    this.server = net.createServer((conn) => this.handle(conn))
    await new Promise<void>((resolve, reject) => {
      this.server!.once('error', reject)
      this.server!.listen(this.socketPath, () => resolve())
    })
    if (!win) await fs.chmod(this.socketPath, 0o600)
    app.on('will-quit', () => {
      this.server?.close()
      for (const f of win ? [this.scriptPath, helper] : [this.socketPath, this.scriptPath, helper]) {
        fs.rm(f, { force: true }).catch(() => {})
      }
    })
  }

  /** How to show a prompt to the user (set by main once the window exists) */
  setAsker(asker: Asker, dismiss?: Dismisser) {
    this.asker = asker
    this.dismiss = dismiss ?? null
  }

  /** Whether prompts can be shown (the helper's server is listening) */
  get available() {
    return !!this.server
  }

  /** Environment for git / ssh so that their prompts come to Gitfy */
  env(): Record<string, string> {
    if (!this.server) return {}
    return {
      SSH_ASKPASS: this.scriptPath,
      // Use askpass even when there is no DISPLAY / when a terminal exists (e.g. `bun run dev`)
      SSH_ASKPASS_REQUIRE: 'force',
      GITFY_ASKPASS_SOCK: this.socketPath,
      GITFY_ASKPASS_TOKEN: this.token,
    }
  }

  /** Forget remembered answers (all, or only those of some kinds, e.g. HTTPS username / password) */
  clear(kinds?: AskpassRequest['kind'][]) {
    for (const [prompt, r] of this.remembered) {
      if (!kinds || kinds.includes(r.kind)) {
        this.remembered.delete(prompt)
        this.answeredFor.delete(prompt)
      }
    }
    if (!kinds) this.answeredFor.clear()
  }

  private handle(conn: net.Socket) {
    let buf = ''
    let id = 0
    conn.setEncoding('utf8')
    conn.on('data', async (d) => {
      buf += d
      const nl = buf.indexOf('\n')
      if (nl < 0 || id) return
      id = this.nextId++
      let msg: { token?: unknown; prompt?: unknown; asker?: unknown }
      try {
        msg = JSON.parse(buf.slice(0, nl))
      } catch {
        return conn.destroy()
      }
      const given = Buffer.from(typeof msg.token === 'string' ? msg.token : '')
      const expected = Buffer.from(this.token)
      if (given.length !== expected.length || !timingSafeEqual(given, expected)) return conn.destroy()
      const prompt = typeof msg.prompt === 'string' ? msg.prompt.slice(0, 500) : ''

      const asker = typeof msg.asker === 'number' ? msg.asker : -1
      // The helper (and the ssh / git behind it) went away: take its dialog down
      conn.once('close', () => this.dismiss?.(id))
      const value = await this.answer(id, prompt, asker, () => conn.destroyed)
      if (!conn.destroyed) conn.end(JSON.stringify(value === null ? { ok: false } : { ok: true, value }) + '\n')
    })
    conn.on('error', () => {})
  }

  private async answer(id: number, prompt: string, asker: number, gone: () => boolean): Promise<string | null> {
    // ssh re-asks within the same process when the passphrase was wrong
    const retry = asker > 0 && this.answeredFor.get(prompt) === asker
    if (retry) this.remembered.delete(prompt) // a remembered answer was rejected
    const cached = this.remembered.get(prompt)
    if (cached !== undefined) {
      this.answeredFor.set(prompt, asker)
      return cached.value
    }
    if (!this.asker || gone()) return null

    const kind: AskpassRequest['kind'] = /passphrase/i.test(prompt)
      ? 'passphrase'
      : /password/i.test(prompt)
        ? 'password'
        : /username/i.test(prompt)
          ? 'username'
          : /\(yes\/no/i.test(prompt)
            ? 'confirm'
            : 'text'
    const { value, remember } = await this.asker({ id, prompt: prompt.trim(), kind, retry })
    if (value === null || gone()) {
      this.answeredFor.delete(prompt)
      return null
    }
    this.answeredFor.set(prompt, asker)
    if (remember && kind !== 'confirm') this.remembered.set(prompt, { value, kind })
    return value
  }
}

export const askpass = new AskpassService()
