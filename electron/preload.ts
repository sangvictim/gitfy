import { contextBridge, ipcRenderer } from 'electron'
import type {
  AskpassRequest,
  BlameResult,
  CompareResult,
  FileHistoryEntry,
  LineSelection,
  LogFilter,
  BranchList,
  CheckoutResult,
  Commit,
  CommitFile,
  ConflictDetail,
  ConflictResolution,
  DiffContent,
  HistoryState,
  MergeResult,
  OperationKind,
  IgnoreCheck,
  LfsInfo,
  PullMode,
  PullResult,
  PushOptions,
  RepoIdentity,
  SubmoduleInfo,
  PushResult,
  IpcResult,
  OpenTabs,
  RepoInfo,
  RepoOperation,
  RepoStatus,
  Settings,
  SshKeyInfo,
  SshTestResult,
  CommitRelation,
  ResetMode,
  RewriteInfo,
  RewriteResult,
  StashApplyResult,
  TagPushResult,
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
    log: (repo: string, limit?: number, filter?: Partial<LogFilter>) => invoke<Commit[]>('git:log', repo, limit, filter),
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
    updateRemote: (repo: string, oldName: string, name: string, url: string) =>
      invoke<void>('git:updateRemote', repo, oldName, name, url),
    fetchAll: (repo: string, prune?: boolean) => invoke<void>('git:fetchAll', repo, prune),
    removeRemote: (repo: string, name: string) => invoke<void>('git:removeRemote', repo, name),
    pull: (repo: string, mode?: PullMode) => invoke<PullResult>('git:pull', repo, mode),
    push: (repo: string, opts?: PushOptions) => invoke<PushResult>('git:push', repo, opts),
    submodules: (repo: string) => invoke<SubmoduleInfo[]>('git:submodules', repo),
    updateSubmodules: (repo: string, path?: string) => invoke<void>('git:updateSubmodules', repo, path),
    lfsInfo: (repo: string) => invoke<LfsInfo>('git:lfsInfo', repo),
    identity: (repo: string) => invoke<RepoIdentity>('git:identity', repo),
    setIdentity: (repo: string, name: string, email: string) => invoke<void>('git:setIdentity', repo, name, email),
    readGitignore: (repo: string) => invoke<string>('git:readGitignore', repo),
    writeGitignore: (repo: string, content: string) => invoke<void>('git:writeGitignore', repo, content),
    addToGitignore: (repo: string, pattern: string) => invoke<void>('git:addToGitignore', repo, pattern),
    checkIgnore: (repo: string, file: string) => invoke<IgnoreCheck>('git:checkIgnore', repo, file),
    merge: (repo: string, from: string, noFastForward?: boolean) =>
      invoke<MergeResult>('git:merge', repo, from, noFastForward),
    conflict: (repo: string, file: string) => invoke<ConflictDetail>('git:conflict', repo, file),
    resolveConflict: (repo: string, file: string, resolution: ConflictResolution) =>
      invoke<void>('git:resolveConflict', repo, file, resolution),
    continueOperation: (repo: string, message?: string) =>
      invoke<RepoOperation | null>('git:continueOperation', repo, message),
    abortOperation: (repo: string) => invoke<OperationKind>('git:abortOperation', repo),
    fileHistory: (repo: string, file: string) => invoke<FileHistoryEntry[]>('git:fileHistory', repo, file),
    blame: (repo: string, file: string, rev?: string) => invoke<BlameResult>('git:blame', repo, file, rev),
    applyLines: (repo: string, file: string, staged: boolean, sel: LineSelection) =>
      invoke<void>('git:applyLines', repo, file, staged, sel),
    compare: (repo: string, base: string, head: string) => invoke<CompareResult>('git:compare', repo, base, head),
    compareFileDiff: (repo: string, base: string, head: string, file: string, from?: string) =>
      invoke<DiffContent>('git:compareFileDiff', repo, base, head, file, from),
    authors: (repo: string) => invoke<string[]>('git:authors', repo),
    rewriteInfo: (repo: string, base: string) => invoke<RewriteInfo>('git:rewriteInfo', repo, base),
    commitRelation: (repo: string, hash: string) => invoke<CommitRelation>('git:commitRelation', repo, hash),
    rebase: (repo: string, onto: string) => invoke<RewriteResult>('git:rebase', repo, onto),
    cherryPick: (repo: string, hash: string) => invoke<RewriteResult>('git:cherryPick', repo, hash),
    revert: (repo: string, hash: string) => invoke<RewriteResult>('git:revert', repo, hash),
    reset: (repo: string, hash: string, mode: ResetMode) => invoke<void>('git:reset', repo, hash, mode),
    headMessage: (repo: string) => invoke<string>('git:headMessage', repo),
    amend: (repo: string, summary: string, description?: string) =>
      invoke<string>('git:amend', repo, summary, description),
    stashPush: (repo: string, message?: string, includeUntracked?: boolean) =>
      invoke<void>('git:stashPush', repo, message, includeUntracked),
    stashApply: (repo: string, ref: string, pop?: boolean) => invoke<StashApplyResult>('git:stashApply', repo, ref, pop),
    stashDrop: (repo: string, ref: string) => invoke<void>('git:stashDrop', repo, ref),
    createTag: (repo: string, name: string, target?: string, message?: string) =>
      invoke<void>('git:createTag', repo, name, target, message),
    deleteTag: (repo: string, name: string, fromRemote?: boolean) =>
      invoke<TagPushResult | null>('git:deleteTag', repo, name, fromRemote),
    pushTags: (repo: string, name?: string) => invoke<TagPushResult>('git:pushTags', repo, name),
    discard: (repo: string, files: string[]) => invoke<void>('git:discard', repo, files),
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
