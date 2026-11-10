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
  /** Conflicted files with what kind of conflict each one is */
  conflicts: ConflictFile[]
  /** A merge / cherry-pick / revert / rebase that stopped and is waiting for the user */
  operation: RepoOperation | null
}

export type OperationKind = 'merge' | 'cherry-pick' | 'revert' | 'rebase'

export interface RepoOperation {
  kind: OperationKind
  /** What is being brought in: a branch name for a merge, "abc1234 subject" for a cherry-pick… */
  incoming: string | null
  /** Prepared commit message (MERGE_MSG) — used to complete the operation */
  message: string | null
}

/**
 * How the two sides changed the file. "ours" is the checked-out branch (Current),
 * "theirs" the one being merged in (Incoming).
 */
export type ConflictKind =
  | 'both-modified'
  | 'both-added'
  | 'both-deleted'
  | 'deleted-by-us'
  | 'deleted-by-them'
  | 'added-by-us'
  | 'added-by-them'

export interface ConflictFile {
  path: string
  kind: ConflictKind
}

/** Everything the conflict resolver needs for one file */
export interface ConflictDetail {
  path: string
  kind: ConflictKind
  /** Working-tree file, normally containing <<<<<<< ======= >>>>>>> markers */
  working: string
  /** Current branch's version (stage 2), null if it doesn't exist on that side */
  ours: string | null
  /** Incoming version (stage 3), null if it doesn't exist on that side */
  theirs: string | null
  binary: boolean
  tooLarge: boolean
}

/** 'ours' / 'theirs' take that side's whole file (deleting it if that side deleted it) */
export type ConflictResolution = { side: 'ours' | 'theirs' } | { content: string }

export interface MergeResult {
  /** Branch that was merged into */
  branch: string
  /** The other branch / commit */
  from: string
  /** Commits brought in (0 = already up to date) */
  commits: number
  fastForward: boolean
  /** Files left with conflicts — the merge is waiting to be resolved or aborted */
  conflicts: string[]
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
  /** The pull merged with conflicts; they must be resolved (or the merge aborted) */
  conflicts?: string[]
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

/** What happened when a stash was applied / popped */
export interface StashApplyResult {
  /** Files left with conflicts (a popped stash is then kept, not dropped) */
  conflicts: string[]
  /** The stash was removed from the list (pop without conflicts) */
  dropped: boolean
}

export interface TagPushResult {
  remote: string
}

export type ResetMode = 'soft' | 'mixed' | 'hard'

/** Result of a rebase / cherry-pick / revert */
export interface RewriteResult {
  /** Files left with conflicts: the operation is waiting to be continued or aborted */
  conflicts: string[]
  /** Commits added on top of where HEAD was */
  commits: number
}

/** What rewriting history back to some commit would affect */
export interface RewriteInfo {
  /** Commits between that commit and HEAD (rewritten by a rebase / dropped by a reset) */
  commits: number
  /** How many of those the upstream already has — rewriting them means a force push later */
  pushed: number
  upstream: string | null
}

export interface CommitRelation {
  isHead: boolean
  /** The commit is part of the checked-out branch */
  inHead: boolean
}
