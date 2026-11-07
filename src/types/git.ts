// Shared types between Electron main process and React renderer.
// Keep this file free of runtime code so both sides can import it.

/** Tabs to restore on the next launch: repository root paths, in tab order */
export interface OpenTabs {
  repos: string[]
  /** Path of the tab that was active, if it held a repository */
  active: string | null
}

export interface RepoInfo {
  path: string
  name: string
}

export type FileChangeType =
  | 'modified'
  | 'added'
  | 'deleted'
  | 'renamed'
  | 'untracked'
  | 'conflicted'
  | 'typechange'

export interface FileChange {
  path: string
  /** Original path for renames */
  from?: string
  type: FileChangeType
}

export interface RepoStatus {
  branch: string | null
  tracking: string | null
  ahead: number
  behind: number
  detached: boolean
  staged: FileChange[]
  unstaged: FileChange[]
  conflicted: string[]
}

export interface DiffContent {
  path: string
  original: string
  modified: string
  binary: boolean
  /** True if one side exceeds the size limit and was truncated */
  tooLarge: boolean
}

export interface CommitRef {
  type: 'local' | 'remote' | 'tag' | 'head'
  /** Short name: "main", "origin/main", "v1.0", or "HEAD" for a detached head */
  name: string
  /** Local branch that HEAD points to */
  current?: boolean
}

export interface Commit {
  hash: string
  shortHash: string
  parents: string[]
  authorName: string
  authorEmail: string
  /** Author date (ISO) */
  date: string
  /** Committer date (ISO) — what the graph is ordered by */
  commitDate: string
  subject: string
  body: string
  refs: CommitRef[]
}

export interface CommitFile {
  path: string
  from?: string
  status: string
}

export interface Branch {
  name: string
  current: boolean
  remote: boolean
  /** Full commit hash the branch points to */
  commit: string
  label: string
}

export interface TagRef {
  name: string
  /** Commit the tag points to (peeled for annotated tags) */
  commit: string
}

export interface StashRef {
  /** e.g. stash@{0} */
  ref: string
  message: string
  commit: string
}

/** A configured remote (git remote -v) */
export interface RemoteInfo {
  name: string
  /** Fetch URL */
  url: string
}

export interface BranchList {
  current: string | null
  local: Branch[]
  remote: Branch[]
  /** All configured remotes, including ones that have no fetched branches yet */
  remotes: RemoteInfo[]
  tags: TagRef[]
  stashes: StashRef[]
}

/** What happened when switching branches */
export interface CheckoutResult {
  /** Local branch now checked out */
  branch: string
  /** Branch it tracks, if any (e.g. origin/staging) */
  upstream?: string
  /** Local branch was fast-forwarded this many commits to the remote branch */
  fastForwarded?: number
  /** Commits the local branch is behind / ahead of its upstream (after switching) */
  behind?: number
  ahead?: number
  /** Fast-forward was possible but failed (e.g. local changes in the way) */
  fastForwardError?: string
}

/** Labels of the operations that can be undone / redone (null = nothing) */
export interface HistoryState {
  undo: string | null
  redo: string | null
}

/** 'ff' = fast-forward if possible, otherwise merge · 'ff-only' = refuse if a merge would be needed */
export type PullMode = 'ff' | 'ff-only'

export interface PullResult {
  branch: string
  /** Commits brought into the branch (0 = already up to date) */
  commits: number
}

export interface PushResult {
  branch: string
  remote: string
  /** The branch had no upstream; it now tracks <remote>/<branch> */
  setUpstream: boolean
}

export interface SshSettings {
  /** Use keys from the system ssh-agent instead of the key file below */
  useAgent: boolean
  privateKey: string | null
  publicKey: string | null
}

export interface Settings {
  ssh: SshSettings
}

export interface SshKeyInfo {
  status: 'ok' | 'none' | 'missing' | 'passphrase' | 'invalid' | 'unknown'
  type?: string
  fingerprint?: string
  /** The selected public key is not the pair of the private key */
  mismatch?: boolean
  detail?: string
}

export interface SshTestResult {
  ok: boolean
  message: string
}

/** A prompt from ssh / git (key passphrase, HTTPS username / password…) shown as a dialog */
export interface AskpassRequest {
  id: number
  prompt: string
  kind: 'passphrase' | 'password' | 'username' | 'confirm' | 'text'
  /** The previous answer to this prompt was rejected */
  retry: boolean
}

/** Uniform IPC result wrapper — errors are serialised as messages, never thrown across the bridge */
export type IpcResult<T> = { ok: true; data: T } | { ok: false; error: string }
