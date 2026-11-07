import { contextBridge, ipcRenderer } from 'electron'
import type {
  AskpassRequest,
  BranchList,
  CheckoutResult,
  Commit,
  CommitFile,
  DiffContent,
  HistoryState,
  PullMode,
  PullResult,
  PushResult,
  IpcResult,
  OpenTabs,
  RepoInfo,
  RepoStatus,
  Settings,
  SshKeyInfo,
  SshTestResult,
} from '../src/types/git'

const invoke = <T>(channel: string, ...args: unknown[]) =>
  ipcRenderer.invoke(channel, ...args) as Promise<IpcResult<T>>

/**
 * The only surface the renderer can use to reach the OS / git.
 * Every call resolves to an IpcResult — it never throws across the bridge.
 */
const api = {
  dialog: {
    selectDirectory: (title?: string) => invoke<string | null>('dialog:selectDirectory', title),
  },
  repo: {
    open: (dir: string, remember?: boolean) => invoke<RepoInfo>('repo:open', dir, remember),
    init: (dir: string) => invoke<RepoInfo>('repo:init', dir),
    clone: (url: string, parentDir: string, name?: string) => invoke<RepoInfo>('repo:clone', url, parentDir, name),
    close: (repo: string) => invoke<void>('repo:close', repo),
    recent: () => invoke<RepoInfo[]>('repo:recent'),
    removeRecent: (path: string) => invoke<RepoInfo[]>('repo:removeRecent', path),
    reveal: (repo: string) => invoke<string>('repo:reveal', repo),
  },
  tabs: {
    get: () => invoke<OpenTabs>('tabs:get'),
    save: (tabs: OpenTabs) => invoke<void>('tabs:save', tabs),
  },
  /** ssh / git prompts (key passphrase, HTTPS credentials) answered through a dialog */
  askpass: {
    onRequest: (cb: (req: AskpassRequest) => void) => {
      const listener = (_e: unknown, req: AskpassRequest) => cb(req)
      ipcRenderer.on('askpass:request', listener)
      return () => {
        ipcRenderer.removeListener('askpass:request', listener)
      }
    },
    reply: (id: number, value: string | null, remember: boolean) =>
      ipcRenderer.send('askpass:reply', { id, value, remember }),
  },
  /** Global settings */
  settings: {
    get: () => invoke<Settings>('settings:get'),
    sshKeyInfo: () => invoke<SshKeyInfo>('settings:sshKeyInfo'),
    setSshAgent: (useAgent: boolean) => invoke<Settings>('settings:setSshAgent', useAgent),
    browseSshKey: (kind: 'private' | 'public') => invoke<Settings>('settings:browseSshKey', kind),
    generateSshKey: () => invoke<{ settings: Settings; publicKey: string }>('settings:generateSshKey'),
    readSshPublicKey: () => invoke<string>('settings:readSshPublicKey'),
    testSsh: (host?: string) => invoke<SshTestResult>('settings:testSsh', host),
  },
  /** Every git call takes the repository root path of the tab it belongs to */
  git: {
    status: (repo: string) => invoke<RepoStatus>('git:status', repo),
    stage: (repo: string, files: string[]) => invoke<void>('git:stage', repo, files),
    stageAll: (repo: string) => invoke<void>('git:stageAll', repo),
    unstage: (repo: string, files: string[]) => invoke<void>('git:unstage', repo, files),
    unstageAll: (repo: string) => invoke<void>('git:unstageAll', repo),
    fileDiff: (repo: string, file: string, staged: boolean, from?: string) =>
      invoke<DiffContent>('git:fileDiff', repo, file, staged, from),
    commit: (repo: string, summary: string, description?: string, newBranch?: string) =>
      invoke<string>('git:commit', repo, summary, description, newBranch),
    log: (repo: string, limit?: number) => invoke<Commit[]>('git:log', repo, limit),
    getCommit: (repo: string, hash: string) => invoke<Commit>('git:getCommit', repo, hash),
    commitFiles: (repo: string, hash: string) => invoke<CommitFile[]>('git:commitFiles', repo, hash),
    commitFileDiff: (repo: string, hash: string, file: string, from?: string) =>
      invoke<DiffContent>('git:commitFileDiff', repo, hash, file, from),
    branches: (repo: string) => invoke<BranchList>('git:branches', repo),
    checkout: (repo: string, name: string, remote?: boolean) =>
      invoke<CheckoutResult>('git:checkout', repo, name, remote),
    createBranch: (repo: string, name: string, checkout?: boolean) =>
      invoke<void>('git:createBranch', repo, name, checkout),
    deleteBranch: (repo: string, name: string, force?: boolean) =>
      invoke<void>('git:deleteBranch', repo, name, force),
    addRemote: (repo: string, name: string, url: string) => invoke<void>('git:addRemote', repo, name, url),
    fetchAll: (repo: string) => invoke<void>('git:fetchAll', repo),
    pull: (repo: string, mode?: PullMode) => invoke<PullResult>('git:pull', repo, mode),
    push: (repo: string) => invoke<PushResult>('git:push', repo),
    history: (repo: string) => invoke<HistoryState>('git:history', repo),
    undo: (repo: string) => invoke<string>('git:undo', repo),
    redo: (repo: string) => invoke<string>('git:redo', repo),
  },
  app: {
    version: () => invoke<string>('app:version'),
    /** Tell the main process the UI is ready, so it can close the splash screen */
    ready: () => ipcRenderer.send('app:ready'),
  },
}

export type GitfyApi = typeof api

contextBridge.exposeInMainWorld('gitfy', api)
