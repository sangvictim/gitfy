import { simpleGit, type SimpleGit } from 'simple-git'
import { askpass } from './askpass.service'
import { settingsService } from './settings.service'

/**
 * simple-git for commands that talk to a remote (fetch / pull / push / clone).
 * There is no terminal to answer prompts in a GUI, so everything is non-interactive:
 * HTTPS credential prompts are disabled (credential helpers still work) and SSH uses the key /
 * agent from Settings → SSH in batch mode. A command is aborted after a long silence.
 */
/** Environment variables passed through to network git commands */
const NET_ENV_KEYS = /^(PATH|HOME|USER|LOGNAME|SHELL|LANG|LANGUAGE|LC_[A-Z_]+|TMPDIR|TEMP|TMP|SSH_AUTH_SOCK|DISPLAY|WAYLAND_DISPLAY|XAUTHORITY|XDG_[A-Z_]+|DBUS_SESSION_BUS_ADDRESS|HTTP_PROXY|HTTPS_PROXY|NO_PROXY|ALL_PROXY|http_proxy|https_proxy|no_proxy|all_proxy|GNUPGHOME)$/
/** Abort a network command after this long without any output */
export const NET_IDLE_TIMEOUT_MS = 300_000 // includes time spent typing a passphrase

/**
 * simple-git for commands that talk to a remote. There is no terminal to answer prompts in a GUI,
 * so HTTPS credential prompts are disabled (fail fast with a clear message instead of hanging);
 * credential helpers, ssh-agent and the desktop's ssh-askpass still work.
 */
export function netGitAt(baseDir: string): SimpleGit {
  const env: Record<string, string> = {}
  for (const [k, v] of Object.entries(process.env)) if (v !== undefined && NET_ENV_KEYS.test(k)) env[k] = v
  return simpleGit({
    baseDir,
    allowEnvironment: ['GIT_TERMINAL_PROMPT', 'GIT_MERGE_AUTOEDIT', 'GIT_SSH_COMMAND', 'SSH_ASKPASS', 'SSH_ASKPASS_REQUIRE'],
    // GIT_SSH_COMMAND is built by us from the SSH settings (key chosen via the native file dialog);
    // SSH_ASKPASS is Gitfy's own helper that shows the passphrase / password dialog
    unsafe: { allowUnsafeSshCommand: true, allowUnsafeAskPass: true },
    timeout: { block: NET_IDLE_TIMEOUT_MS },
  }).env({
    ...env,
    GIT_TERMINAL_PROMPT: '0',
    GIT_MERGE_AUTOEDIT: 'no',
    GIT_SSH_COMMAND: settingsService.sshCommand(),
    ...askpass.env(),
  })
}

/** Turn common remote failures into messages a user can act on */
export function friendlyRemoteError(err: unknown, action: 'pull' | 'push' | 'fetch' | 'clone'): Error {
  const msg = err instanceof Error ? err.message : String(err)
  const authFailed = /terminal prompts disabled|could not read (Username|Password)|Authentication failed|Permission denied \(publickey|read_passphrase|incorrect passphrase/i.test(msg)
  if (authFailed) {
    // Never keep re-sending an answer that was rejected
    askpass.clear()
    if (askpass.consumeCancelled()) return new Error(`${action[0].toUpperCase()}${action.slice(1)} cancelled — no passphrase / password was entered.`)
  }
  if (/terminal prompts disabled|could not read (Username|Password)|Authentication failed/i.test(msg)) {
    return new Error(`Couldn't ${action}: the remote rejected the username / password.\n\n${msg}`)
  }
  if (/Permission denied \(publickey\)|Host key verification failed|read_passphrase/i.test(msg)) {
    return new Error(`Couldn't ${action}: SSH authentication failed. Check the SSH key in Settings → SSH (Test connection), and that its public key is added to your Git host.\n\n${msg}`)
  }
  if (/block timeout reached/i.test(msg)) {
    return new Error(`Couldn't ${action}: the remote stopped responding (no output for ${NET_IDLE_TIMEOUT_MS / 1000}s).`)
  }
  return err instanceof Error ? err : new Error(msg)
}
