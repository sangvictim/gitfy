import fs from 'node:fs/promises'
import path from 'node:path'
import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git'
import type {
  BlameCommit,
  BlameResult,
  Branch,
  BranchList,
  Commit,
  CommitFile,
  CheckoutResult,
  CommitRef,
  ConflictDetail,
  ConflictFile,
  ConflictKind,
  ConflictResolution,
  CompareResult,
  DiffContent,
  FileChange,
  FileHistoryEntry,
  FileChangeType,
  HistoryState,
  IgnoreCheck,
  LfsInfo,
  LineSelection,
  LogFilter,
  MergeResult,
  OperationKind,
  PullMode,
  PullResult,
  PushOptions,
  PushResult,
  RemoteInfo,
  RepoIdentity,
  RepoOperation,
  RepoStatus,
  CommitRelation,
  ResetMode,
  RewriteInfo,
  RewriteResult,
  StashApplyResult,
  StashRef,
  SubmoduleInfo,
  TagPushResult,
  TagRef,
} from '../../src/types/git'
import { describe, history, StaleOperationError, type Op } from './history.service'
import { friendlyRemoteError, netGitAt } from './net'
import { repoService } from './repo.service'

const MAX_DIFF_BYTES = 2 * 1024 * 1024
const LOG_LIMIT = 1000
const FIELD = '\x1f'
const RECORD = '\x1e'

/** simple-git bound to an open repository (throws if the renderer passes a path it never opened) */
function git(repo: string): SimpleGit {
  return simpleGit(repoService.require(repo).path)
}

/** Resolve a repo-relative path and make sure it cannot escape the repository root */
function safeJoin(repo: string, rel: string): string {
  const root = repoService.require(repo).path
  const abs = path.resolve(root, rel)
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error(`Path "${rel}" is outside the repository`)
  }
  return abs
}

function assertPaths(repo: string, files: unknown): string[] {
  if (!Array.isArray(files) || files.length === 0 || !files.every((f) => typeof f === 'string' && f)) {
    throw new Error('A non-empty list of file paths is required')
  }
  files.forEach((f) => safeJoin(repo, f))
  return files
}

async function hasHead(g: SimpleGit): Promise<boolean> {
  try {
    // --quiet fails with exit code 1 and no output, which simple-git resolves with '' instead of throwing
    return !!(await g.raw(['rev-parse', '--verify', '--quiet', 'HEAD'])).trim()
  } catch {
    return false
  }
}

async function assertBranchName(repo: string, name: string) {
  if (typeof name !== 'string' || !name.trim()) throw new Error('Branch name is required')
  try {
    await git(repo).raw(['check-ref-format', '--branch', name])
  } catch {
    throw new Error(`"${name}" is not a valid branch name`)
  }
}

/** Commit HEAD points to, or null on an unborn branch */
async function headHash(repo: string): Promise<string | null> {
  return refHash(repo, 'HEAD')
}

/** Commit a ref points to, or null if it doesn't exist */
async function refHash(repo: string, ref: string): Promise<string | null> {
  try {
    return (await git(repo).raw(['rev-parse', '--verify', '--quiet', `${ref}^{commit}`])).trim() || null
  } catch {
    return null
  }
}

/** Checked-out branch name (also for an unborn branch), or null when HEAD is detached */
async function currentBranch(repo: string): Promise<string | null> {
  try {
    return (await git(repo).raw(['symbolic-ref', '--short', '--quiet', 'HEAD'])).trim() || null
  } catch {
    return null
  }
}

// ---------------------------------------------------------------------------
// Status & staging
// ---------------------------------------------------------------------------

function mapCode(code: string): FileChangeType {
  switch (code) {
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    case 'R':
    case 'C':
      return 'renamed'
    case 'T':
      return 'typechange'
    case '?':
      return 'untracked'
    case 'U':
      return 'conflicted'
    default:
      return 'modified'
  }
}

/** Unmerged index/worktree status pairs (git status --porcelain) */
const CONFLICT_CODES: Record<string, ConflictKind> = {
  UU: 'both-modified',
  AA: 'both-added',
  DD: 'both-deleted',
  DU: 'deleted-by-us',
  UD: 'deleted-by-them',
  AU: 'added-by-us',
  UA: 'added-by-them',
}

function toRepoStatus(s: StatusResult, operation: RepoOperation | null): RepoStatus {
  const staged: FileChange[] = []
  const unstaged: FileChange[] = []
  const conflicts: ConflictFile[] = []
  const conflicted = new Set(s.conflicted)

  for (const f of s.files) {
    const x = f.index
    const y = f.working_dir
    const kind = CONFLICT_CODES[`${x}${y}`]
    if (kind || conflicted.has(f.path)) {
      conflicted.add(f.path)
      conflicts.push({ path: f.path, kind: kind ?? 'both-modified' })
      unstaged.push({ path: f.path, type: 'conflicted' })
      continue
    }
    if (x === '?' && y === '?') {
      unstaged.push({ path: f.path, type: 'untracked' })
      continue
    }
    if (x && x !== ' ') {
      staged.push({ path: f.path, from: f.from || undefined, type: mapCode(x) })
    }
    if (y && y !== ' ') {
      unstaged.push({ path: f.path, type: mapCode(y) })
    }
  }

  const byPath = (a: { path: string }, b: { path: string }) => a.path.localeCompare(b.path)
  return {
    branch: s.current,
    tracking: s.tracking,
    ahead: s.ahead,
    behind: s.behind,
    detached: s.detached,
    staged: staged.sort(byPath),
    unstaged: unstaged.sort(byPath),
    conflicted: [...conflicted].sort(),
    conflicts: conflicts.sort(byPath),
    operation,
  }
}

export async function getStatus(repo: string): Promise<RepoStatus> {
  const [s, operation] = await Promise.all([git(repo).status(['--untracked-files=all']), getOperation(repo)])
  return toRepoStatus(s, operation)
}

export async function stage(repo: string, files: string[]) {
  const list = assertPaths(repo, files)
  // `git add` also stages deletions of tracked files in git >= 2.0
  await git(repo).raw(['add', '-A', '--', ...list])
}

export async function stageAll(repo: string) {
  await git(repo).raw(['add', '-A'])
}

export async function unstage(repo: string, files: string[]) {
  const list = assertPaths(repo, files)
  const g = git(repo)
  if (await hasHead(g)) {
    await g.raw(['reset', '-q', 'HEAD', '--', ...list])
  } else {
    // Unborn branch (no commits yet): nothing to reset to, just drop from index.
    // -f is needed: without it git refuses when the staged content differs from the file on disk
    await g.raw(['rm', '--cached', '-r', '-f', '-q', '--', ...list])
  }
}

export async function unstageAll(repo: string) {
  const g = git(repo)
  if (await hasHead(g)) {
    await g.raw(['reset', '-q', 'HEAD'])
  } else {
    await g.raw(['rm', '--cached', '-r', '-f', '-q', '--', '.'])
  }
}

// ---------------------------------------------------------------------------
// Diff
// ---------------------------------------------------------------------------

interface Blob {
  text: string
  binary: boolean
  tooLarge: boolean
}

const EMPTY: Blob = { text: '', binary: false, tooLarge: false }

function toBlob(buf: Buffer): Blob {
  if (buf.subarray(0, 8000).includes(0)) return { text: '', binary: true, tooLarge: false }
  if (buf.length > MAX_DIFF_BYTES) {
    return { text: buf.subarray(0, MAX_DIFF_BYTES).toString('utf8'), binary: false, tooLarge: true }
  }
  return { text: buf.toString('utf8'), binary: false, tooLarge: false }
}

/** Read `<rev>:<path>` from the object database. rev '' means the index. */
async function readObject(repo: string, rev: string, file: string): Promise<Blob> {
  try {
    const buf = await git(repo).showBuffer([`${rev}:${file}`])
    return toBlob(buf)
  } catch {
    return EMPTY // file does not exist at that revision
  }
}

async function readWorkingFile(repo: string, file: string): Promise<Blob> {
  try {
    return toBlob(await fs.readFile(safeJoin(repo, file)))
  } catch {
    return EMPTY // deleted from working tree
  }
}

function makeDiff(file: string, a: Blob, b: Blob): DiffContent {
  return {
    path: file,
    original: a.text,
    modified: b.text,
    binary: a.binary || b.binary,
    tooLarge: a.tooLarge || b.tooLarge,
  }
}

export async function getFileDiff(repo: string, file: string, staged: boolean, from?: string): Promise<DiffContent> {
  safeJoin(repo, file)
  if (from) safeJoin(repo, from)
  if (staged) {
    // HEAD -> index
    const original = (await hasHead(git(repo))) ? await readObject(repo, 'HEAD', from ?? file) : EMPTY
    const modified = await readObject(repo, '', file)
    return makeDiff(file, original, modified)
  }
  // index -> working tree
  const original = await readObject(repo, '', file)
  const modified = await readWorkingFile(repo, file)
  return makeDiff(file, original, modified)
}

// ---------------------------------------------------------------------------
// Commit & history
// ---------------------------------------------------------------------------

/**
 * Commit the staged changes — on the current branch, or (with `newBranch`) on a new branch created
 * from the current position, which is checked out first so the staged changes go with it.
 */
export async function commit(repo: string, summary: string, description?: string, newBranch?: string): Promise<string> {
  const subject = (summary ?? '').trim()
  if (!subject) throw new Error('Commit summary is required')
  const body = (description ?? '').trim()
  const message = body ? `${subject}\n\n${body}` : subject
  const g = git(repo)
  let branch = await currentBranch(repo)
  const parent = await headHash(repo)

  let created: { name: string; prevBranch: string | null } | null = null
  if (typeof newBranch === 'string') {
    const name = newBranch.trim()
    await assertBranchName(repo, name)
    if (await refHash(repo, `refs/heads/${name}`)) throw new Error(`A branch named '${name}' already exists`)
    // Check before creating the branch, so a failed commit doesn't leave an empty branch behind
    if (!(await g.raw(['diff', '--cached', '--name-only'])).trim()) {
      throw new Error('Nothing to commit — stage some changes first')
    }
    if (parent) await g.raw(['switch', '-c', name])
    else await g.raw(['symbolic-ref', 'HEAD', `refs/heads/${name}`]) // no commits yet: just rename the unborn branch
    created = { name, prevBranch: branch }
    branch = name
  }

  /** Put HEAD back where it was if the commit didn't happen */
  const rollback = async () => {
    if (!created) return
    try {
      if (parent) {
        await g.raw(created.prevBranch ? ['switch', created.prevBranch] : ['switch', '--detach', parent])
        await g.raw(['branch', '-D', '--', created.name])
      } else if (created.prevBranch) {
        await g.raw(['symbolic-ref', 'HEAD', `refs/heads/${created.prevBranch}`])
      }
    } catch {
      /* best effort — the original error is more useful to the user */
    }
  }

  let result
  try {
    result = await g.commit(message)
  } catch (err) {
    await rollback()
    throw err
  }
  if (!result.commit) {
    await rollback()
    throw new Error('Nothing to commit — stage some changes first')
  }
  const hash = (await headHash(repo)) ?? result.commit
  // Two undo steps for a new-branch commit: first the commit, then the branch
  if (created && parent) {
    history.record(repo, {
      kind: 'createBranch',
      name: created.name,
      hash: parent,
      checkedOut: true,
      prev: created.prevBranch ?? parent,
      prevDetached: !created.prevBranch,
    })
  }
  history.record(repo, { kind: 'commit', branch, hash, parent, subject })
  return hash
}

const COMMIT_FORMAT = ['%H', '%h', '%P', '%an', '%ae', '%aI', '%cI', '%D', '%s', '%b'].join(FIELD) + RECORD

/** Parse `%D` produced with --decorate=full, e.g. "HEAD -> refs/heads/main, refs/remotes/origin/main, tag: refs/tags/v1" */
function parseRefs(raw: string): CommitRef[] {
  const refs: CommitRef[] = []
  for (let part of raw.split(', ').filter(Boolean)) {
    let current = false
    if (part.startsWith('HEAD -> ')) {
      current = true
      part = part.slice('HEAD -> '.length)
    }
    if (part.startsWith('tag: ')) part = part.slice('tag: '.length)
    if (part === 'HEAD') refs.push({ type: 'head', name: 'HEAD' })
    else if (part.startsWith('refs/heads/')) refs.push({ type: 'local', name: part.slice(11), current })
    else if (part.startsWith('refs/remotes/')) {
      const name = part.slice(13)
      if (!name.endsWith('/HEAD')) refs.push({ type: 'remote', name })
    } else if (part.startsWith('refs/tags/')) refs.push({ type: 'tag', name: part.slice(10) })
  }
  return refs
}

function parseCommits(out: string): Commit[] {
  return out
    .split(RECORD)
    .map((r) => r.replace(/^\n/, ''))
    .filter(Boolean)
    .map((r) => {
      const [hash, shortHash, parents, authorName, authorEmail, date, commitDate, refs, subject, body] = r.split(FIELD)
      return {
        hash,
        shortHash,
        parents: parents ? parents.split(' ') : [],
        authorName,
        authorEmail,
        date,
        commitDate,
        subject,
        body: (body ?? '').trim(),
        refs: parseRefs(refs ?? ''),
      }
    })
}

export async function getCommit(repo: string, hash: string): Promise<Commit> {
  assertHash(hash)
  const [commit] = parseCommits(await git(repo).raw(['show', '-s', '--decorate=full', `--format=${COMMIT_FORMAT}`, hash]))
  if (!commit) throw new Error(`Commit ${hash} not found`)
  return commit
}

export async function getLog(repo: string, limit = LOG_LIMIT, filter?: Partial<LogFilter>): Promise<Commit[]> {
  const g = git(repo)
  if (!(await hasHead(g))) return []
  const branch = filter?.branch ? assertRefName(filter.branch) : null
  if (branch && !(await refHash(repo, branch))) return []
  const author = typeof filter?.author === 'string' && filter.author.trim() ? filter.author.trim() : null
  const out = await g.raw([
    'log',
    ...(branch ? [branch] : ['--exclude=refs/stash', '--all']),
    // The name is matched literally, not as a regular expression
    ...(author ? ['--fixed-strings', `--author=${author}`] : []),
    // Chronological (children still before parents) — interleaves branches like most Git GUIs
    '--date-order',
    '--decorate=full',
    `--max-count=${Math.max(1, Math.min(limit, 5000))}`,
    `--format=${COMMIT_FORMAT}`,
  ])
  return parseCommits(out)
}

function assertHash(hash: string) {
  if (typeof hash !== 'string' || !/^[0-9a-f]{4,64}$/i.test(hash)) throw new Error('Invalid commit hash')
}

async function firstParent(repo: string, hash: string): Promise<string | null> {
  const out = await git(repo).raw(['rev-list', '--parents', '-n', '1', hash])
  const parts = out.trim().split(' ')
  return parts[1] ?? null
}

/** A stash commit made with --include-untracked keeps the untracked files in its third parent */
async function stashUntrackedParent(repo: string, hash: string): Promise<string | null> {
  const stashes = await getStashes(repo)
  if (!stashes.some((st) => st.commit.startsWith(hash) || hash.startsWith(st.commit))) return null
  return refHash(repo, `${hash}^3`)
}

export async function getCommitFiles(repo: string, hash: string): Promise<CommitFile[]> {
  assertHash(hash)
  const parent = await firstParent(repo, hash)
  const out = parent
    ? await git(repo).raw(['diff', '--name-status', '-M', parent, hash])
    : await git(repo).raw(['diff-tree', '--root', '--no-commit-id', '-r', '-M', '--name-status', hash])
  const files: CommitFile[] = out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, a, b] = line.split('\t')
      return b ? { status: status[0], from: a, path: b } : { status: status[0], path: a }
    })
  const withStats = await withNumstat(
    repo,
    files,
    parent ? ['diff', parent, hash] : ['diff-tree', '--root', '--no-commit-id', '-r', hash],
  )
  const untracked = await stashUntrackedParent(repo, hash)
  if (untracked) {
    const names = (await git(repo).raw(['ls-tree', '-r', '--name-only', untracked])).split('\n').filter(Boolean)
    withStats.push(...names.map((path) => ({ status: 'A', path })))
  }
  return withStats
}

export async function getCommitFileDiff(repo: string, hash: string, file: string, from?: string): Promise<DiffContent> {
  assertHash(hash)
  safeJoin(repo, file)
  if (from) safeJoin(repo, from)
  const parent = await firstParent(repo, hash)
  const original = parent ? await readObject(repo, parent, from ?? file) : EMPTY
  let modified = await readObject(repo, hash, file)
  if (modified === EMPTY) {
    // Untracked file saved in a stash
    const untracked = await stashUntrackedParent(repo, hash)
    if (untracked) modified = await readObject(repo, untracked, file)
  }
  return makeDiff(file, original, modified)
}

// ---------------------------------------------------------------------------
// Branches
// ---------------------------------------------------------------------------

export async function getBranches(repo: string): Promise<BranchList> {
  const out = await git(repo).raw([
    'for-each-ref',
    `--format=%(refname)${FIELD}%(objectname)${FIELD}%(HEAD)${FIELD}%(contents:subject)${FIELD}%(*objectname)`,
    'refs/heads',
    'refs/remotes',
    'refs/tags',
  ])
  const local: Branch[] = []
  const remote: Branch[] = []
  const tags: TagRef[] = []
  let current: string | null = null

  for (const line of out.split('\n').filter(Boolean)) {
    const [ref, commit, head, label, peeled] = line.split(FIELD)
    if (ref.startsWith('refs/tags/')) {
      tags.push({ name: ref.slice('refs/tags/'.length), commit: peeled || commit })
    } else if (ref.startsWith('refs/heads/')) {
      const name = ref.slice('refs/heads/'.length)
      const isCurrent = head === '*'
      if (isCurrent) current = name
      local.push({ name, current: isCurrent, remote: false, commit, label })
    } else if (ref.startsWith('refs/remotes/')) {
      const name = ref.slice('refs/remotes/'.length)
      if (name.endsWith('/HEAD')) continue
      remote.push({ name, current: false, remote: true, commit, label })
    }
  }

  // Unborn branch: no ref exists yet but HEAD still points at a name
  if (!current) {
    try {
      current = (await git(repo).raw(['symbolic-ref', '--short', '-q', 'HEAD'])).trim() || null
    } catch {
      current = null // detached HEAD
    }
  }
  return { current, local, remote, remotes: await getRemotes(repo), tags, stashes: await getStashes(repo) }
}

async function getRemotes(repo: string): Promise<RemoteInfo[]> {
  try {
    const out = await git(repo).raw(['remote', '-v'])
    const map = new Map<string, string>()
    for (const line of out.split('\n')) {
      // origin<TAB>git@github.com:me/repo.git (fetch)
      const m = /^(\S+)\t(.+) \((fetch|push)\)$/.exec(line.trim().replace(/\s+\t/, '\t'))
      if (m && m[3] === 'fetch') map.set(m[1], m[2])
    }
    return [...map.entries()].map(([name, url]) => ({ name, url }))
  } catch {
    return []
  }
}

async function getStashes(repo: string): Promise<StashRef[]> {
  try {
    const out = await git(repo).raw(['stash', 'list', `--format=%H${FIELD}%gd${FIELD}%gs`])
    return out
      .split('\n')
      .filter(Boolean)
      .map((line) => {
        const [commit, ref, message] = line.split(FIELD)
        return { commit, ref, message }
      })
  } catch {
    return []
  }
}

/** [behind, ahead] of `local` relative to `other` */
async function aheadBehind(repo: string, local: string, other: string): Promise<[number, number]> {
  const out = await git(repo).raw(['rev-list', '--left-right', '--count', `${other}...${local}`])
  const [behind, ahead] = out.trim().split(/\s+/).map(Number)
  return [behind || 0, ahead || 0]
}

/** Upstream of the checked-out branch and how far it is from it (empty if it has none) */
async function upstreamState(repo: string): Promise<Pick<CheckoutResult, 'upstream' | 'behind' | 'ahead'>> {
  try {
    const upstream = (await git(repo).raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).trim()
    if (!upstream) return {}
    const [behind, ahead] = await aheadBehind(repo, 'HEAD', upstream)
    return { upstream, behind, ahead }
  } catch {
    return {}
  }
}

export async function checkoutBranch(repo: string, name: string, isRemote = false): Promise<CheckoutResult> {
  const fromBranch = await currentBranch(repo)
  const fromHead = await headHash(repo)
  const localName = isRemote ? name.split('/').slice(1).join('/') : name
  const existedBefore = isRemote ? (await refHash(repo, `refs/heads/${localName}`)) !== null : true
  const localBefore = isRemote ? await refHash(repo, `refs/heads/${localName}`) : null

  const result = await doCheckout(repo, name, isRemote)

  const from = fromBranch ?? fromHead
  if (from && !(fromBranch === result.branch && !result.fastForwarded)) {
    const op: Op = { kind: 'checkout', from, fromDetached: !fromBranch, to: result.branch }
    if (isRemote && !existedBefore && result.upstream) op.created = { upstream: result.upstream }
    if (result.fastForwarded && localBefore) {
      const after = await headHash(repo)
      if (after) op.ff = { before: localBefore, after }
    }
    history.record(repo, op)
  }
  return result
}

async function doCheckout(repo: string, name: string, isRemote: boolean): Promise<CheckoutResult> {
  const g = git(repo)
  if (!isRemote) {
    await assertBranchName(repo, name)
    await g.raw(['switch', name])
    return { branch: name, ...(await upstreamState(repo)) }
  }

  // Remote branch "origin/feature/x" -> local "feature/x" tracking it
  const { remote, local } = await getBranches(repo)
  if (!remote.some((b) => b.name === name)) throw new Error(`Remote branch "${name}" not found`)
  const localName = name.split('/').slice(1).join('/')
  await assertBranchName(repo, localName)

  if (!local.some((b) => b.name === localName)) {
    await g.raw(['switch', '-c', localName, '--track', name])
    return { branch: localName, upstream: name }
  }

  // A local branch with that name already exists: switch to it, and if it is merely behind the
  // remote branch (no commits of its own) fast-forward it, so the user lands on the commit they picked.
  await g.raw(['switch', localName])
  const [behind, ahead] = await aheadBehind(repo, localName, name)
  if (behind > 0 && ahead === 0) {
    try {
      await g.raw(['merge', '--ff-only', '--quiet', name])
      return { branch: localName, upstream: name, fastForwarded: behind }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return { branch: localName, upstream: name, behind, ahead, fastForwardError: msg }
    }
  }
  return { branch: localName, upstream: name, behind, ahead }
}

export async function createBranch(repo: string, name: string, checkout = true) {
  await assertBranchName(repo, name)
  const g = git(repo)
  if (!(await hasHead(g))) {
    throw new Error('Cannot create a branch before the first commit')
  }
  const prevBranch = await currentBranch(repo)
  const hash = (await headHash(repo))!
  if (checkout) await g.raw(['switch', '-c', name])
  else await g.raw(['branch', name])
  history.record(repo, {
    kind: 'createBranch',
    name,
    hash,
    checkedOut: checkout,
    prev: prevBranch ?? hash,
    prevDetached: !prevBranch,
  })
}

export async function deleteBranch(repo: string, name: string, force = false) {
  await assertBranchName(repo, name)
  const { current } = await getBranches(repo)
  if (name === current) throw new Error('Cannot delete the branch you are currently on')
  const hash = await refHash(repo, `refs/heads/${name}`)
  await git(repo).raw(['branch', force ? '-D' : '-d', '--', name])
  if (hash) history.record(repo, { kind: 'deleteBranch', name, hash })
}

// ---------------------------------------------------------------------------
// Remote: add / fetch / pull / push
// ---------------------------------------------------------------------------

function cleanRemoteName(name: unknown): string {
  const n = typeof name === 'string' ? name.trim() : ''
  if (!n) throw new Error('Remote name is required')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(n) || n.endsWith('.lock') || n.includes('..')) {
    throw new Error(`"${n}" is not a valid remote name`)
  }
  return n
}

function cleanRemoteUrl(url: unknown): string {
  const u = typeof url === 'string' ? url.trim() : ''
  if (!u) throw new Error('Remote URL is required')
  // Reject option injection, whitespace/control characters and transport helpers like ext::<command>
  if (u.startsWith('-') || /[\s\x00-\x1f]/.test(u) || /^[A-Za-z][A-Za-z0-9+.-]*::/.test(u)) {
    throw new Error('That does not look like a valid remote URL')
  }
  return u
}

export async function addRemote(repo: string, name: string, url: string) {
  repoService.require(repo)
  const n = cleanRemoteName(name)
  const u = cleanRemoteUrl(url)
  const existing = await getRemotes(repo)
  if (existing.some((r) => r.name === n)) throw new Error(`A remote named "${n}" already exists`)
  await git(repo).raw(['remote', 'add', '--', n, u])
}

/** Rename a remote and/or change its URL */
export async function updateRemote(repo: string, oldName: string, name: string, url: string) {
  repoService.require(repo)
  const from = cleanRemoteName(oldName)
  const to = cleanRemoteName(name)
  const u = cleanRemoteUrl(url)
  const existing = await getRemotes(repo)
  const current = existing.find((r) => r.name === from)
  if (!current) throw new Error(`Remote "${from}" no longer exists`)
  if (to !== from && existing.some((r) => r.name === to)) throw new Error(`A remote named "${to}" already exists`)
  const g = git(repo)
  // Change the URL first: if it fails nothing has been renamed yet
  if (u !== current.url) await g.raw(['remote', 'set-url', '--', from, u])
  if (to !== from) await g.raw(['remote', 'rename', '--', from, to])
}

export async function removeRemote(repo: string, name: string) {
  const n = cleanRemoteName(name)
  if (!(await getRemotes(repo)).some((r) => r.name === n)) throw new Error(`Remote "${n}" no longer exists`)
  // Also deletes its remote-tracking branches and any upstream settings pointing at it
  await git(repo).raw(['remote', 'remove', '--', n])
}

function netGit(repo: string): SimpleGit {
  return netGitAt(repoService.require(repo).path)
}

/** Fetch every remote; with `prune`, also drop remote branches that were deleted on the server */
export async function fetchAll(repo: string, prune = false) {
  try {
    await netGit(repo).raw(['fetch', '--all', ...(prune ? ['--prune', '--prune-tags'] : [])])
  } catch (err) {
    throw friendlyRemoteError(err, 'fetch')
  }
}

export async function pull(repo: string, mode: PullMode = 'ff'): Promise<PullResult> {
  const branch = await currentBranch(repo)
  if (!branch) throw new Error('Cannot pull with a detached HEAD — switch to a branch first')
  const before = await headHash(repo)
  if (await getOperation(repo)) throw new Error('Finish or abort the merge in progress before pulling')
  const modeArg = mode === 'ff-only' ? '--ff-only' : mode === 'rebase' ? '--rebase' : '--no-rebase'
  /** A pull --rebase that stopped on conflicts is recorded for undo once it is continued to the end */
  const stopped = (conflicts: string[]): PullResult => {
    if (mode === 'rebase' && before) pendingMoves.set(pendingKey(repo), { what: `pull (rebase) into ${branch}`, branch, before })
    return { branch, commits: 0, conflicts }
  }
  try {
    // --no-edit: never wait for an editor to write a merge commit message
    await netGit(repo).raw(['pull', '--no-edit', modeArg])
    // Conflicts are reported on stdout, so the command may "succeed"
    const conflicts = await stoppedOnConflicts(repo)
    if (conflicts) return stopped(conflicts)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/cannot pull with rebase|You have unstaged changes|Your index contains uncommitted changes/i.test(msg)) {
      throw new Error(`Commit or stash your changes before pulling with rebase.\n\n${msg}`)
    }
    if (/no tracking information/i.test(msg)) {
      throw new Error(`'${branch}' has no upstream branch to pull from. Push it first to create one.`)
    }
    if (/Not possible to fast-forward|diverging branches/i.test(msg)) {
      throw new Error(`'${branch}' and its upstream have diverged, so a fast-forward-only pull isn't possible. Use "Pull (fast-forward if possible)" to merge.`)
    }
    const conflicts = await stoppedOnConflicts(repo)
    if (conflicts) return stopped(conflicts)
    if (/would be overwritten by merge|commit your changes or stash them/i.test(msg)) {
      throw new Error(`Your uncommitted changes would be overwritten by the pull. Commit or stash them first.\n\n${msg}`)
    }
    throw friendlyRemoteError(err, 'pull')
  }
  const after = await headHash(repo)
  let commits = 0
  if (after && after !== before) {
    commits = before ? Number((await git(repo).raw(['rev-list', '--count', `${before}..${after}`])).trim()) : 0
    if (before) history.record(repo, { kind: 'pull', branch, before, after })
  }
  return { branch, commits }
}

export async function push(repo: string, opts: PushOptions = {}): Promise<PushResult> {
  const force = opts?.force === true
  const tags = opts?.tags === true
  const chosen = typeof opts?.remote === 'string' ? cleanRemoteName(opts.remote) : null
  const branch = await currentBranch(repo)
  if (!branch) throw new Error('Cannot push with a detached HEAD — switch to a branch first')
  if (!(await hasHead(git(repo)))) throw new Error('Nothing to push yet — make a commit first')
  const g = git(repo)
  const cfg = async (key: string) => {
    try {
      return (await g.raw(['config', '--get', key])).trim() || null
    } catch {
      return null
    }
  }
  const upstreamRemote = await cfg(`branch.${branch}.remote`)
  const upstreamMerge = await cfg(`branch.${branch}.merge`)
  let remote: string
  let setUpstream = false
  let args: string[]
  const remotes = (await g.raw(['remote'])).split('\n').map((r) => r.trim()).filter(Boolean)
  if (chosen && !remotes.includes(chosen)) throw new Error(`Remote "${chosen}" no longer exists`)
  const hasUpstream = !!upstreamRemote && !!upstreamMerge && upstreamRemote !== '.'
  if (hasUpstream && (!chosen || chosen === upstreamRemote)) {
    remote = upstreamRemote!
    args = ['push', remote, `HEAD:${upstreamMerge}`]
  } else {
    if (remotes.length === 0) throw new Error('This repository has no remote to push to')
    // A chosen remote, or (no upstream yet) origin / the only remote; it becomes the upstream
    remote = chosen ?? (remotes.includes('origin') ? 'origin' : remotes[0])
    setUpstream = true
    args = ['push', '--set-upstream', remote, branch]
  }
  // --force-with-lease only overwrites the remote branch if it is still where we last fetched it
  if (force) args.splice(1, 0, '--force-with-lease')
  if (tags) args.splice(1, 0, '--tags')
  try {
    await netGit(repo).raw(args)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/stale info/i.test(msg)) {
      throw new Error(`Force push refused: ${remote} has commits you haven't fetched yet, so they would be lost. Fetch first and check them.`)
    }
    if (/rejected/i.test(msg) && /(non-fast-forward|fetch first|behind)/i.test(msg)) {
      throw new Error(
        `Push rejected: ${remote} has commits that '${branch}' doesn't have. Pull first — or, if you rewrote history ` +
          `(rebase / amend / reset), use "Force push (with lease)".`,
      )
    }
    throw friendlyRemoteError(err, 'push')
  }
  // Pushed commits are shared now — undoing local history past this point would diverge from the remote
  history.clear(repo)
  return { branch, remote, setUpstream, forced: force }
}

// ---------------------------------------------------------------------------
// Merge & conflicts
// ---------------------------------------------------------------------------

/** Absolute .git directory of each open repository (per worktree) */
const gitDirs = new Map<string, string>()

async function gitDir(repo: string): Promise<string> {
  const root = repoService.require(repo).path
  let dir = gitDirs.get(root)
  if (!dir) {
    dir = path.resolve(root, (await git(repo).raw(['rev-parse', '--absolute-git-dir'])).trim())
    gitDirs.set(root, dir)
  }
  return dir
}

async function readGitFile(repo: string, name: string): Promise<string | null> {
  try {
    return await fs.readFile(path.join(await gitDir(repo), name), 'utf8')
  } catch {
    return null
  }
}

async function gitFileExists(repo: string, name: string): Promise<boolean> {
  try {
    await fs.access(path.join(await gitDir(repo), name))
    return true
  } catch {
    return false
  }
}

/** Commit message git prepared for the operation, without its "# ..." comment lines */
function cleanMessage(raw: string | null): string | null {
  if (!raw) return null
  const text = raw
    .split('\n')
    .filter((l) => !l.startsWith('#'))
    .join('\n')
    .trim()
  return text || null
}

/** "Merge branch 'feature' into main" -> "feature"; "Merge branch 'main' of <origin's url>" (a pull) -> "origin/main" */
async function incomingFromMessage(repo: string, msg: string | null): Promise<string | null> {
  const m = msg && /^Merge (?:remote-tracking )?branch(?:es)? '([^']+)'(?: of (\S+))?/.exec(msg)
  if (!m) return null
  if (!m[2]) return m[1]
  const remote = (await getRemotes(repo)).find((r) => r.url === m[2])
  return remote ? `${remote.name}/${m[1]}` : `${m[1]} (remote)`
}

async function describeCommit(repo: string, ref: string): Promise<string | null> {
  try {
    return (await git(repo).raw(['log', '-1', '--format=%h %s', ref])).trim() || null
  } catch {
    return null
  }
}

/** A merge / cherry-pick / revert / rebase that stopped half-way (e.g. on conflicts) */
async function getOperation(repo: string): Promise<RepoOperation | null> {
  try {
    if (await gitFileExists(repo, 'MERGE_HEAD')) {
      const message = cleanMessage(await readGitFile(repo, 'MERGE_MSG'))
      let incoming = await incomingFromMessage(repo, message)
      if (!incoming) {
        const hash = (await readGitFile(repo, 'MERGE_HEAD'))?.trim().split('\n')[0]
        if (hash) incoming = (await describeCommit(repo, hash))?.split(' ')[0] ?? hash.slice(0, 7)
      }
      return { kind: 'merge', incoming, message }
    }
    if (await gitFileExists(repo, 'CHERRY_PICK_HEAD')) {
      return {
        kind: 'cherry-pick',
        incoming: await describeCommit(repo, 'CHERRY_PICK_HEAD'),
        message: cleanMessage(await readGitFile(repo, 'MERGE_MSG')),
      }
    }
    if (await gitFileExists(repo, 'REVERT_HEAD')) {
      return {
        kind: 'revert',
        incoming: await describeCommit(repo, 'REVERT_HEAD'),
        message: cleanMessage(await readGitFile(repo, 'MERGE_MSG')),
      }
    }
    for (const dir of ['rebase-merge', 'rebase-apply']) {
      if (await gitFileExists(repo, dir)) {
        const onto = (await readGitFile(repo, `${dir}/onto`))?.trim()
        return { kind: 'rebase', incoming: onto ? await describeCommit(repo, onto) : null, message: null }
      }
    }
  } catch {
    /* repository closed meanwhile */
  }
  return null
}

const OPERATION_LABEL: Record<OperationKind, string> = {
  merge: 'merge',
  'cherry-pick': 'cherry-pick',
  revert: 'revert',
  rebase: 'rebase',
}

async function requireOperation(repo: string): Promise<RepoOperation> {
  const op = await getOperation(repo)
  if (!op) throw new Error('There is no merge in progress')
  return op
}

/** Read one stage of an unmerged file (1 = base, 2 = ours, 3 = theirs); null if that side has no file */
async function readStage(repo: string, stage: 1 | 2 | 3, file: string): Promise<Blob | null> {
  try {
    return toBlob(await git(repo).showBuffer([`:${stage}:${file}`]))
  } catch {
    return null
  }
}

async function conflictKindOf(repo: string, file: string): Promise<ConflictKind> {
  const status = await getStatus(repo)
  const c = status.conflicts.find((f) => f.path === file)
  if (!c) throw new Error(`'${file}' has no conflict to resolve (already resolved?)`)
  return c.kind
}

export async function getConflict(repo: string, file: string): Promise<ConflictDetail> {
  safeJoin(repo, file)
  const kind = await conflictKindOf(repo, file)
  const [ours, theirs] = await Promise.all([readStage(repo, 2, file), readStage(repo, 3, file)])
  let working: Blob = EMPTY
  try {
    working = toBlob(await fs.readFile(safeJoin(repo, file)))
  } catch {
    /* deleted in the working tree */
  }
  return {
    path: file,
    kind,
    working: working.text,
    ours: ours?.text ?? null,
    theirs: theirs?.text ?? null,
    binary: !!(working.binary || ours?.binary || theirs?.binary),
    tooLarge: !!(working.tooLarge || ours?.tooLarge || theirs?.tooLarge),
  }
}

/** Resolve one conflicted file and mark it resolved (stage it) */
export async function resolveConflict(repo: string, file: string, resolution: ConflictResolution) {
  const abs = safeJoin(repo, file)
  await conflictKindOf(repo, file)
  const g = git(repo)

  if (resolution && 'content' in resolution && typeof resolution.content === 'string') {
    await fs.writeFile(abs, resolution.content, 'utf8')
    await g.raw(['add', '--', file])
    return
  }

  const side = resolution && 'side' in resolution ? resolution.side : null
  if (side !== 'ours' && side !== 'theirs') throw new Error('Unknown conflict resolution')
  const exists = (await readStage(repo, side === 'ours' ? 2 : 3, file)) !== null
  if (exists) {
    await g.raw(['checkout', side === 'ours' ? '--ours' : '--theirs', '--', file])
    await g.raw(['add', '--', file])
  } else {
    // That side deleted the file: resolving to it means deleting it
    await g.raw(['rm', '-q', '-f', '--', file])
  }
}

function assertRefName(ref: unknown): string {
  if (typeof ref !== 'string' || !ref.trim() || ref.startsWith('-') || /[\s\x00-\x1f]/.test(ref)) {
    throw new Error('Invalid branch name')
  }
  return ref.trim()
}

/** Merge `from` (a local or remote branch) into the checked-out branch */
export async function merge(repo: string, from: string, noFastForward = false): Promise<MergeResult> {
  const name = assertRefName(from)
  const branch = await currentBranch(repo)
  if (!branch) throw new Error('Cannot merge with a detached HEAD — switch to a branch first')
  if (name === branch) throw new Error(`Can't merge '${name}' into itself`)
  const op = await getOperation(repo)
  if (op) throw new Error(`A ${OPERATION_LABEL[op.kind]} is already in progress — finish or abort it first`)
  const target = await refHash(repo, name)
  if (!target) throw new Error(`Branch '${name}' not found`)

  const before = await headHash(repo)
  const g = git(repo)
  let failure: unknown = null
  try {
    await g.raw(['merge', '--no-edit', noFastForward ? '--no-ff' : '--ff', name])
  } catch (err) {
    failure = err
  }
  // git reports conflicts on stdout, so simple-git doesn't always treat them as a failure
  const conflicts = await stoppedOnConflicts(repo)
  if (conflicts) return { branch, from: name, commits: 0, fastForward: false, conflicts }
  if (failure) throw friendlyMergeError(failure instanceof Error ? failure.message : String(failure))
  const after = await headHash(repo)
  let commits = 0
  if (after && after !== before) {
    commits = before ? Number((await g.raw(['rev-list', '--count', `${before}..${after}`])).trim()) : 0
    if (before) history.record(repo, { kind: 'merge', branch, from: name, before, after })
  }
  return { branch, from: name, commits, fastForward: after === target && after !== before, conflicts: [] }
}

/** Conflicted files if the last command left a merge waiting on conflicts, else null */
async function stoppedOnConflicts(repo: string): Promise<string[] | null> {
  const status = await getStatus(repo)
  return status.operation && status.conflicted.length > 0 ? status.conflicted : null
}

function friendlyMergeError(msg: string): Error {
  if (/would be overwritten by merge|commit your changes or stash them/i.test(msg)) {
    return new Error(`Your uncommitted changes would be overwritten by this merge. Commit or stash them first.\n\n${msg}`)
  }
  if (/unrelated histories/i.test(msg)) {
    return new Error(`These branches have no common history, so Gitfy won't merge them.\n\n${msg}`)
  }
  return new Error(msg)
}

/** Finish the operation once every conflict is resolved: commit the merge / continue the cherry-pick… */
export async function continueOperation(repo: string, message?: string): Promise<RepoOperation | null> {
  const op = await requireOperation(repo)
  const status = await getStatus(repo)
  if (status.conflicted.length > 0) {
    throw new Error(`Resolve the remaining ${status.conflicted.length} conflicted file${status.conflicted.length === 1 ? '' : 's'} first`)
  }
  const g = git(repo)
  if (op.kind === 'merge') {
    const branch = await currentBranch(repo)
    const before = await headHash(repo)
    // op.message is MERGE_MSG without git's "# Conflicts:" comment lines (`--no-edit` would keep them)
    const text = (typeof message === 'string' ? message.trim() : '') || op.message || `Merge ${op.incoming ?? 'branch'}`
    await g.raw(['commit', '-q', '-m', text])
    const after = await headHash(repo)
    if (branch && before && after && after !== before) {
      history.record(repo, { kind: 'merge', branch, from: op.incoming ?? 'branch', before, after })
    }
  } else {
    // No terminal to open an editor in: `core.editor=true` keeps the prepared message as is.
    // (simple-git blocks editor settings unless allowed; this one is fixed, never user input)
    await simpleGit({ baseDir: repoService.require(repo).path, unsafe: { allowUnsafeEditor: true } }).raw([
      '-c',
      'core.editor=true',
      op.kind,
      '--continue',
    ])
  }
  // A rebase can stop again on the next commit
  const still = await getOperation(repo)
  const pending = pendingMoves.get(pendingKey(repo))
  if (!still && pending) {
    pendingMoves.delete(pendingKey(repo))
    const after = await headHash(repo)
    if (after && after !== pending.before) {
      history.record(repo, { kind: 'headMove', what: pending.what, branch: pending.branch, before: pending.before, after, mode: 'keep' })
    }
  }
  return still
}

/** Abort the operation and go back to how things were before it started */
export async function abortOperation(repo: string): Promise<OperationKind> {
  const op = await requireOperation(repo)
  await git(repo).raw([op.kind, '--abort'])
  pendingMoves.delete(pendingKey(repo))
  return op.kind
}

// ---------------------------------------------------------------------------
// History rewriting: rebase, cherry-pick, revert, reset, amend
// ---------------------------------------------------------------------------

/**
 * A rebase / cherry-pick / revert started from Gitfy that stopped on conflicts: remembered so that,
 * once it is continued to the end, it can be recorded for undo like one that finished right away.
 */
const pendingMoves = new Map<string, { what: string; branch: string | null; before: string }>()

function pendingKey(repo: string) {
  return repoService.require(repo).path
}

async function isAncestor(repo: string, ancestor: string, of: string): Promise<boolean> {
  // `merge-base --is-ancestor` only answers through its exit code, which simple-git doesn't always
  // surface; comparing the merge base is unambiguous
  const a = await refHash(repo, ancestor)
  if (!a) return false
  try {
    return (await git(repo).raw(['merge-base', a, of])).trim() === a
  } catch {
    return false // no common history
  }
}

async function upstreamOf(repo: string): Promise<string | null> {
  try {
    return (await git(repo).raw(['rev-parse', '--abbrev-ref', '--symbolic-full-name', '@{u}'])).trim() || null
  } catch {
    return null
  }
}

async function countRevs(repo: string, args: string[]): Promise<number> {
  return Number((await git(repo).raw(['rev-list', '--count', ...args])).trim()) || 0
}

/** Refuse to start while something else is half-done or files are conflicted */
async function assertCleanStart(repo: string, what: string) {
  const op = await getOperation(repo)
  if (op) throw new Error(`Finish or abort the ${OPERATION_LABEL[op.kind]} in progress before starting a ${what}`)
  if ((await getStatus(repo)).conflicted.length) throw new Error(`Resolve the conflicted files before starting a ${what}`)
}

function friendlyRewriteError(msg: string, what: string): Error {
  if (/would be overwritten|commit your changes or stash them|You have unstaged changes|Your index contains uncommitted changes|cannot (rebase|cherry-pick|revert)/i.test(msg)) {
    return new Error(`Commit or stash your local changes before the ${what}.\n\n${msg}`)
  }
  return new Error(msg)
}

/**
 * Run a command that moves HEAD (rebase / cherry-pick / revert). If it stops on conflicts, the
 * operation is left for the user to resolve; otherwise it is recorded for undo.
 */
async function runMove(repo: string, what: string, args: string[]): Promise<RewriteResult> {
  const branch = await currentBranch(repo)
  const before = await headHash(repo)
  if (!before) throw new Error(`Make a first commit before a ${what.split(' ')[0]}`)
  let failure: unknown = null
  try {
    await git(repo).raw(args)
  } catch (err) {
    failure = err
  }
  const conflicts = await stoppedOnConflicts(repo)
  if (conflicts) {
    pendingMoves.set(pendingKey(repo), { what, branch, before })
    return { conflicts, commits: 0 }
  }
  if (failure) {
    // A rebase / cherry-pick that stopped for another reason (e.g. an empty commit) must not be left half-done
    const op = await getOperation(repo)
    if (op) await git(repo).raw([op.kind, '--abort']).catch(() => {})
    throw friendlyRewriteError(failure instanceof Error ? failure.message : String(failure), what.split(' ')[0])
  }
  const after = await headHash(repo)
  if (after && after !== before) {
    history.record(repo, { kind: 'headMove', what, branch, before, after, mode: 'keep' })
  }
  return { conflicts: [], commits: after && after !== before ? await countRevs(repo, [`${before}..${after}`]).catch(() => 0) : 0 }
}

/** What rewriting history from `base` to HEAD would affect: commits rewritten / dropped, and how many are pushed */
export async function rewriteInfo(repo: string, baseRef: string): Promise<RewriteInfo> {
  // A commit hash (reset) or a branch name (rebase onto it)
  const base = await refHash(repo, assertRefName(baseRef))
  if (!base) throw new Error(`'${baseRef}' not found`)
  const upstream = await upstreamOf(repo)
  const commits = await countRevs(repo, [`${base}..HEAD`])
  // Commits in base..HEAD that the upstream already has = all of them minus those only here
  const pushed = upstream ? commits - (await countRevs(repo, ['HEAD', `^${base}`, `^${upstream}`])) : 0
  return { commits, pushed, upstream }
}

/** Relationship between a commit and HEAD (decides which actions the commit panel offers) */
export async function commitRelation(repo: string, hash: string): Promise<CommitRelation> {
  assertHash(hash)
  const head = await headHash(repo)
  if (!head) return { isHead: false, inHead: false }
  const full = await refHash(repo, hash)
  return { isHead: full === head, inHead: full ? await isAncestor(repo, full, head) : false }
}

/** Rebase the checked-out branch onto `onto` (a local or remote branch) */
export async function rebase(repo: string, onto: string): Promise<RewriteResult> {
  const name = assertRefName(onto)
  const branch = await currentBranch(repo)
  if (!branch) throw new Error('Switch to a branch before rebasing')
  if (name === branch) throw new Error(`Can't rebase '${branch}' onto itself`)
  await assertCleanStart(repo, 'rebase')
  const target = await refHash(repo, name)
  if (!target) throw new Error(`Branch '${name}' not found`)
  if (await isAncestor(repo, target, 'HEAD')) throw new Error(`'${branch}' already contains everything in '${name}' — nothing to rebase`)
  return runMove(repo, `rebase of ${branch} onto ${name}`, ['rebase', name])
}

async function parentCount(repo: string, hash: string): Promise<number> {
  return (await git(repo).raw(['rev-list', '--parents', '-n', '1', hash])).trim().split(' ').length - 1
}

/** Apply a commit from elsewhere on top of HEAD */
export async function cherryPick(repo: string, hash: string): Promise<RewriteResult> {
  assertHash(hash)
  await assertCleanStart(repo, 'cherry-pick')
  const full = await refHash(repo, hash)
  if (!full) throw new Error(`Commit ${hash} not found`)
  if (await isAncestor(repo, full, 'HEAD')) throw new Error('That commit is already part of the current branch')
  const merge = (await parentCount(repo, full)) > 1
  // A merge commit is picked relative to its first parent (the branch it was merged into)
  return runMove(repo, `cherry-pick of ${full.slice(0, 7)}`, ['cherry-pick', ...(merge ? ['-m', '1'] : []), full])
}

/** Add a commit that undoes `hash` */
export async function revert(repo: string, hash: string): Promise<RewriteResult> {
  assertHash(hash)
  await assertCleanStart(repo, 'revert')
  const full = await refHash(repo, hash)
  if (!full) throw new Error(`Commit ${hash} not found`)
  if (!(await isAncestor(repo, full, 'HEAD'))) throw new Error('Only commits that are part of the current branch can be reverted')
  const merge = (await parentCount(repo, full)) > 1
  return runMove(repo, `revert of ${full.slice(0, 7)}`, ['revert', '--no-edit', ...(merge ? ['-m', '1'] : []), full])
}

/** Move the current branch (or detached HEAD) to `hash` */
export async function reset(repo: string, hash: string, mode: ResetMode): Promise<void> {
  assertHash(hash)
  if (mode !== 'soft' && mode !== 'mixed' && mode !== 'hard') throw new Error('Unknown reset mode')
  await assertCleanStart(repo, 'reset')
  const target = await refHash(repo, hash)
  if (!target) throw new Error(`Commit ${hash} not found`)
  const before = await headHash(repo)
  if (!before) throw new Error('Nothing to reset yet — make a first commit')
  if (target === before && mode !== 'hard') throw new Error('The branch is already at that commit')
  const branch = await currentBranch(repo)
  await git(repo).raw(['reset', '-q', `--${mode}`, target])
  if (target !== before) {
    history.record(repo, {
      kind: 'headMove',
      what: `${mode} reset of ${branch ?? 'HEAD'} to ${target.slice(0, 7)}`,
      branch,
      before,
      after: target,
      // A hard reset already threw the local changes away; going back must not clobber newer ones
      mode: mode === 'hard' ? 'keep' : mode,
    })
  }
}

/** The last commit's message, to prefill "amend" */
export async function headMessage(repo: string): Promise<string> {
  if (!(await hasHead(git(repo)))) return ''
  return (await git(repo).raw(['log', '-1', '--format=%B'])).trim()
}

/** Replace the last commit with one containing its changes plus the staged ones, and the new message */
export async function amend(repo: string, summary: string, description?: string): Promise<string> {
  const subject = (summary ?? '').trim()
  if (!subject) throw new Error('Commit summary is required')
  const before = await headHash(repo)
  if (!before) throw new Error('There is no commit to amend yet')
  await assertCleanStart(repo, 'amend')
  const body = (description ?? '').trim()
  const branch = await currentBranch(repo)
  await git(repo).raw(['commit', '-q', '--amend', '--allow-empty', '-m', body ? `${subject}\n\n${body}` : subject])
  const after = (await headHash(repo))!
  // Undo puts the original commit back and leaves what the amend added staged
  history.record(repo, { kind: 'headMove', what: `amend of "${subject.length > 40 ? subject.slice(0, 40) + '…' : subject}"`, branch, before, after, mode: 'soft' })
  return after
}

// ---------------------------------------------------------------------------
// Stash
// ---------------------------------------------------------------------------

function assertStashRef(ref: unknown): string {
  if (typeof ref !== 'string' || !/^stash@\{\d+\}$/.test(ref)) throw new Error('Invalid stash reference')
  return ref
}

/** Stash the working copy (staged, unstaged and — by default — untracked files) */
export async function stashPush(repo: string, message?: string, includeUntracked = true) {
  const status = await getStatus(repo)
  if (status.conflicted.length) throw new Error('Resolve the conflicted files before stashing')
  const untracked = status.unstaged.some((f) => f.type === 'untracked')
  const tracked = status.staged.length > 0 || status.unstaged.some((f) => f.type !== 'untracked')
  if (!tracked && !(includeUntracked && untracked)) {
    throw new Error(untracked ? 'Only untracked files changed — tick "Include untracked files" to stash them' : 'There are no changes to stash')
  }
  if (!(await hasHead(git(repo)))) throw new Error('Make a first commit before stashing')
  const msg = typeof message === 'string' ? message.trim() : ''
  await git(repo).raw(['stash', 'push', ...(includeUntracked ? ['--include-untracked'] : []), ...(msg ? ['-m', msg] : [])])
}

async function stashInfo(repo: string, ref: string) {
  const stash = (await getStashes(repo)).find((s) => s.ref === ref)
  if (!stash) throw new Error(`${ref} no longer exists`)
  return stash
}

/** Apply a stash; with `pop`, also drop it — unless it left conflicts (git keeps it then) */
export async function stashApply(repo: string, ref: string, pop = false): Promise<StashApplyResult> {
  assertStashRef(ref)
  const stash = await stashInfo(repo, ref)
  const op = await getOperation(repo)
  if (op) throw new Error(`Finish or abort the ${OPERATION_LABEL[op.kind]} in progress first`)
  let failure: unknown = null
  try {
    // --index would be needed to restore what was staged, but it refuses whenever that doesn't apply
    // cleanly; plain apply is what users expect from a GUI
    await git(repo).raw(['stash', pop ? 'pop' : 'apply', ref])
  } catch (err) {
    failure = err
  }
  const conflicts = (await getStatus(repo)).conflicted
  if (conflicts.length) return { conflicts, dropped: false }
  if (failure) {
    const msg = failure instanceof Error ? failure.message : String(failure)
    if (/already exists, no checkout|would be overwritten/i.test(msg)) {
      throw new Error(`Some files in the stash would overwrite your current changes. Commit or stash those first.\n\n${msg}`)
    }
    throw failure
  }
  if (pop) history.record(repo, { kind: 'dropStash', hash: stash.commit, message: stash.message })
  return { conflicts: [], dropped: pop }
}

export async function stashDrop(repo: string, ref: string) {
  assertStashRef(ref)
  const stash = await stashInfo(repo, ref)
  await git(repo).raw(['stash', 'drop', '-q', ref])
  history.record(repo, { kind: 'dropStash', hash: stash.commit, message: stash.message })
}

// ---------------------------------------------------------------------------
// Tags
// ---------------------------------------------------------------------------

async function assertTagName(repo: string, name: unknown): Promise<string> {
  const n = typeof name === 'string' ? name.trim() : ''
  if (!n) throw new Error('Tag name is required')
  if (n.startsWith('-')) throw new Error(`"${n}" is not a valid tag name`)
  try {
    await git(repo).raw(['check-ref-format', `refs/tags/${n}`])
  } catch {
    throw new Error(`"${n}" is not a valid tag name`)
  }
  return n
}

/** Create a tag on `target` (default HEAD); with a message it is an annotated tag */
export async function createTag(repo: string, name: string, target?: string, message?: string) {
  const n = await assertTagName(repo, name)
  if (target !== undefined) assertHash(target)
  if (await refHash(repo, `refs/tags/${n}`)) throw new Error(`A tag named '${n}' already exists`)
  const commit = await refHash(repo, target ?? 'HEAD')
  if (!commit) throw new Error(target ? `Commit ${target} not found` : 'Make a first commit before tagging')
  const msg = typeof message === 'string' ? message.trim() : ''
  await git(repo).raw(msg ? ['tag', '-a', '-m', msg, '--', n, commit] : ['tag', '--', n, commit])
}

/** Remote tags are pushed to / deleted from: the current branch's upstream remote, else origin, else the first */
async function defaultRemote(repo: string): Promise<string> {
  const g = git(repo)
  const branch = await currentBranch(repo)
  if (branch) {
    try {
      const r = (await g.raw(['config', '--get', `branch.${branch}.remote`])).trim()
      if (r && r !== '.') return r
    } catch {
      /* no upstream */
    }
  }
  const remotes = (await getRemotes(repo)).map((r) => r.name)
  if (!remotes.length) throw new Error('This repository has no remote')
  return remotes.includes('origin') ? 'origin' : remotes[0]
}

export async function deleteTag(repo: string, name: string, fromRemote = false): Promise<TagPushResult | null> {
  const n = await assertTagName(repo, name)
  let object = ''
  try {
    object = (await git(repo).raw(['rev-parse', '--verify', '--quiet', `refs/tags/${n}`])).trim()
  } catch {
    /* handled below */
  }
  if (!object) throw new Error(`Tag '${n}' not found`)
  let remote: string | null = null
  if (fromRemote) {
    remote = await defaultRemote(repo)
    try {
      await netGit(repo).raw(['push', remote, '--delete', `refs/tags/${n}`])
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      // Never pushed: nothing to delete there, carry on with the local tag
      if (!/remote ref does not exist|unable to delete .*: remote ref does not exist/i.test(msg)) throw friendlyRemoteError(err, 'push')
    }
  }
  await git(repo).raw(['tag', '-d', '--', n])
  // Only a local delete can be undone (a remote one would need another push)
  if (!fromRemote) history.record(repo, { kind: 'deleteTag', name: n, object })
  return remote ? { remote } : null
}

/** Push one tag, or every tag when `name` is omitted */
export async function pushTags(repo: string, name?: string): Promise<TagPushResult> {
  const n = name === undefined ? null : await assertTagName(repo, name)
  if (n && !(await refHash(repo, `refs/tags/${n}`))) throw new Error(`Tag '${n}' not found`)
  const remote = await defaultRemote(repo)
  try {
    await netGit(repo).raw(n ? ['push', remote, `refs/tags/${n}`] : ['push', remote, '--tags'])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/already exists/i.test(msg) && /rejected/i.test(msg)) {
      throw new Error(`${remote} already has ${n ? `a tag '${n}'` : 'some of these tags'} pointing somewhere else.\n\n${msg}`)
    }
    throw friendlyRemoteError(err, 'push')
  }
  return { remote }
}

// ---------------------------------------------------------------------------
// Discard changes
// ---------------------------------------------------------------------------

/**
 * Throw away unstaged changes: tracked files go back to their staged (or committed) version,
 * untracked files are deleted. Staged changes are kept. This cannot be undone.
 */
export async function discard(repo: string, files: string[]) {
  const list = assertPaths(repo, files)
  const status = await getStatus(repo)
  const byPath = new Map(status.unstaged.map((f) => [f.path, f]))
  const tracked: string[] = []
  const untracked: string[] = []
  for (const f of list) {
    const change = byPath.get(f)
    if (!change) continue // nothing to discard (already clean)
    if (change.type === 'conflicted') throw new Error(`'${f}' has a conflict — resolve it instead of discarding`)
    ;(change.type === 'untracked' ? untracked : tracked).push(f)
  }
  const g = git(repo)
  if (tracked.length) await g.raw(['checkout', '--', ...tracked])
  // -f only removes the listed files; ignored files are never touched (no -x)
  if (untracked.length) await g.raw(['clean', '-f', '-q', '--', ...untracked])
}

// ---------------------------------------------------------------------------
// Inspection: file history, blame, partial staging, branch compare
// ---------------------------------------------------------------------------

/** `git diff --numstat -z` output -> path -> [added, deleted] (undefined for binary files) */
function parseNumstat(out: string): Map<string, [number | undefined, number | undefined]> {
  const map = new Map<string, [number | undefined, number | undefined]>()
  const parts = out.split('\0')
  for (let i = 0; i < parts.length; i++) {
    const m = /^(-|\d+)\t(-|\d+)\t(.*)$/s.exec(parts[i].replace(/^\n/, ''))
    if (!m) continue
    const add = m[1] === '-' ? undefined : Number(m[1])
    const del = m[2] === '-' ? undefined : Number(m[2])
    // A rename is "added\tdeleted\t" followed by the old and the new path as separate fields
    const path = m[3] ? m[3] : parts[(i += 2)]
    if (path) map.set(path, [add, del])
  }
  return map
}

/** Attach +/- line counts to a file list */
async function withNumstat(repo: string, files: CommitFile[], args: string[]): Promise<CommitFile[]> {
  try {
    const stats = parseNumstat(await git(repo).raw([...args, '--numstat', '-z', '-M']))
    return files.map((f) => {
      const s = stats.get(f.path)
      return s ? { ...f, additions: s[0], deletions: s[1] } : f
    })
  } catch {
    return files // stats are a nice-to-have
  }
}

const HIST_START = '\x02'

/** Commits that touched a file, following it across renames */
export async function fileHistory(repo: string, file: string, limit = 500): Promise<FileHistoryEntry[]> {
  safeJoin(repo, file)
  if (!(await hasHead(git(repo)))) return []
  const out = await git(repo).raw([
    'log',
    '--follow',
    '-M',
    '--decorate=full',
    `--max-count=${Math.max(1, Math.min(limit, 2000))}`,
    `--format=${HIST_START}${COMMIT_FORMAT}`,
    '--name-status',
    '--',
    file,
  ])
  const entries: FileHistoryEntry[] = []
  for (const chunk of out.split(HIST_START).filter(Boolean)) {
    const end = chunk.lastIndexOf(RECORD)
    const [commit] = parseCommits(chunk.slice(0, end + 1))
    if (!commit) continue
    // e.g. "M\tsrc/a.ts" or "R087\told.ts\tnew.ts"
    const line = chunk.slice(end + 1).split('\n').find((l) => /^[A-Z]\d*\t/.test(l))
    const [status, a, b] = (line ?? `M\t${file}`).split('\t')
    entries.push(b ? { commit, status: status[0], from: a, path: b } : { commit, status: status[0], path: a })
  }
  return entries
}

/** Who last changed each line — of the working copy, or of the file at `rev` */
export async function blame(repo: string, file: string, rev?: string): Promise<BlameResult> {
  safeJoin(repo, file)
  if (rev !== undefined) assertHash(rev)
  if (!(await hasHead(git(repo)))) throw new Error('There is no history to blame yet')
  const out = await git(repo).raw(['blame', '--porcelain', ...(rev ? [rev] : []), '--', file])
  const lines: BlameResult['lines'] = []
  const commits: Record<string, BlameCommit> = {}
  const raw: Record<string, { author?: string; time?: number; summary?: string }> = {}
  let current = ''
  let bytes = 0
  let tooLarge = false
  for (const l of out.split('\n')) {
    const head = /^([0-9a-f]{40}) \d+ \d+/.exec(l)
    if (head) {
      current = head[1]
      raw[current] ??= {}
      continue
    }
    if (l.startsWith('\t')) {
      bytes += l.length
      if (bytes > MAX_DIFF_BYTES) {
        tooLarge = true
        break
      }
      lines.push({ hash: current, text: l.slice(1) })
    } else if (l.startsWith('author ')) raw[current].author = l.slice(7)
    else if (l.startsWith('author-time ')) raw[current].time = Number(l.slice(12))
    else if (l.startsWith('summary ')) raw[current].summary = l.slice(8)
  }
  for (const [hash, r] of Object.entries(raw)) {
    const uncommitted = /^0+$/.test(hash)
    commits[hash] = {
      hash,
      author: uncommitted ? 'You' : (r.author ?? ''),
      date: new Date((r.time ?? Date.now() / 1000) * 1000).toISOString(),
      summary: uncommitted ? 'Not committed yet' : (r.summary ?? ''),
    }
  }
  return { path: file, lines, commits, tooLarge }
}

interface Hunk {
  oldStart: number
  oldCount: number
  newStart: number
  newCount: number
  lines: string[]
}

function parseHunks(diff: string): { header: string[]; hunks: Hunk[] } {
  const header: string[] = []
  const hunks: Hunk[] = []
  for (const line of diff.split('\n')) {
    const m = /^@@ -(\d+)(?:,(\d+))? \+(\d+)(?:,(\d+))? @@/.exec(line)
    if (m) {
      hunks.push({
        oldStart: Number(m[1]),
        oldCount: m[2] === undefined ? 1 : Number(m[2]),
        newStart: Number(m[3]),
        newCount: m[4] === undefined ? 1 : Number(m[4]),
        lines: [],
      })
    } else if (hunks.length) hunks[hunks.length - 1].lines.push(line)
    else header.push(line)
  }
  // The diff ends with a newline: drop the empty string it leaves behind
  for (const h of hunks) while (h.lines.length && h.lines[h.lines.length - 1] === '') h.lines.pop()
  return { header, hunks }
}

/**
 * Build a patch containing only the selected changed lines. Applied forwards (staging) unselected
 * removals stay as context and unselected additions are left out; applied in reverse (unstaging) it is
 * the other way round, because the patch then has to match the index's "new" side.
 */
function partialPatch(header: string[], hunks: Hunk[], oldSel: Set<number>, newSel: Set<number>, reverse: boolean): string | null {
  const out: string[] = []
  for (const h of hunks) {
    let oldNo = h.oldStart
    let newNo = h.newStart
    const body: string[] = []
    let changed = false
    let lastKept = true
    for (const line of h.lines) {
      const tag = line[0]
      if (tag === '\\') {
        if (lastKept) body.push(line) // "\ No newline at end of file" belongs to the line before it
        continue
      }
      if (tag === '-') {
        const picked = oldSel.has(oldNo++)
        if (picked) {
          body.push(line)
          changed = true
          lastKept = true
        } else if (!reverse) {
          body.push(' ' + line.slice(1))
          lastKept = true
        } else lastKept = false
      } else if (tag === '+') {
        const picked = newSel.has(newNo++)
        if (picked) {
          body.push(line)
          changed = true
          lastKept = true
        } else if (reverse) {
          body.push(' ' + line.slice(1))
          lastKept = true
        } else lastKept = false
      } else {
        body.push(line)
        oldNo++
        newNo++
        lastKept = true
      }
    }
    if (!changed) continue
    const oldCount = body.filter((l) => l[0] === ' ' || l[0] === '-').length
    const newCount = body.filter((l) => l[0] === ' ' || l[0] === '+').length
    out.push(`@@ -${h.oldStart},${oldCount} +${h.newStart},${newCount} @@`, ...body)
  }
  if (!out.length) return null
  return [...header.filter((l) => l !== ''), ...out, ''].join('\n')
}

/** Stage (or with `staged`, unstage) some lines or one hunk of a modified file */
export async function applyLines(repo: string, file: string, staged: boolean, sel: LineSelection) {
  safeJoin(repo, file)
  const g = git(repo)
  const diff = await g.raw(['diff', '--no-color', '--no-ext-diff', '-U3', ...(staged ? ['--cached'] : []), '--', file])
  const { header, hunks } = parseHunks(diff)
  if (!hunks.length) throw new Error(staged ? 'Nothing staged in this file' : 'No unstaged changes in this file')
  if (header.some((l) => /^(new file|deleted file|rename from|Binary files)/.test(l))) {
    throw new Error('Line-by-line staging works for modified text files only — stage the whole file instead')
  }
  let oldSel: Set<number>
  let newSel: Set<number>
  if ('hunkAt' in sel) {
    const { side, line } = sel.hunkAt
    const hunk = hunks.find((h) => {
      const start = side === 'old' ? h.oldStart : h.newStart
      const count = side === 'old' ? h.oldCount : h.newCount
      return line >= start && line <= start + Math.max(count, 1) - 1
    })
    if (!hunk) throw new Error('Put the cursor inside a change first')
    oldSel = new Set()
    newSel = new Set()
    let o = hunk.oldStart
    let n = hunk.newStart
    for (const l of hunk.lines) {
      if (l[0] === '-') oldSel.add(o++)
      else if (l[0] === '+') newSel.add(n++)
      else if (l[0] === ' ') {
        o++
        n++
      }
    }
  } else {
    const nums = (a: unknown) => (Array.isArray(a) ? a.filter((x): x is number => Number.isInteger(x) && x > 0) : [])
    oldSel = new Set(nums(sel.oldLines))
    newSel = new Set(nums(sel.newLines))
  }
  const patch = partialPatch(header, hunks, oldSel, newSel, staged)
  if (!patch) throw new Error('The selection contains no changed lines')
  // simple-git can't pipe stdin, so the patch goes through a file inside .git (always writable, never tracked)
  const patchFile = path.join(await gitDir(repo), `gitfy-partial-${process.pid}-${Date.now()}.patch`)
  await fs.writeFile(patchFile, patch, 'utf8')
  try {
    await g.raw(['apply', '--cached', '--recount', '--whitespace=nowarn', ...(staged ? ['-R'] : []), patchFile])
  } finally {
    await fs.rm(patchFile, { force: true })
  }
}

/** Compare two branches / refs: commits on each side and what `head` changed since they split */
export async function compareRefs(repo: string, base: string, head: string): Promise<CompareResult> {
  const b = assertRefName(base)
  const h = assertRefName(head)
  if (!(await refHash(repo, b))) throw new Error(`'${b}' not found`)
  if (!(await refHash(repo, h))) throw new Error(`'${h}' not found`)
  const g = git(repo)
  const log = async (range: string) =>
    parseCommits(await g.raw(['log', '--decorate=full', '--max-count=500', `--format=${COMMIT_FORMAT}`, range]))
  let mergeBase: string | null = null
  try {
    mergeBase = (await g.raw(['merge-base', b, h])).trim() || null
  } catch {
    /* unrelated histories */
  }
  const range = mergeBase ? [mergeBase, h] : [b, h]
  const files: CommitFile[] = (await g.raw(['diff', '--name-status', '-M', ...range]))
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, x, y] = line.split('\t')
      return y ? { status: status[0], from: x, path: y } : { status: status[0], path: x }
    })
  return {
    base: b,
    head: h,
    ahead: await log(`${b}..${h}`),
    behind: await log(`${h}..${b}`),
    files: await withNumstat(repo, files, ['diff', ...range]),
    mergeBase,
  }
}

/** One file in a branch comparison: as it was where the branches split vs. on `head` */
export async function compareFileDiff(repo: string, base: string, head: string, file: string, from?: string): Promise<DiffContent> {
  safeJoin(repo, file)
  if (from) safeJoin(repo, from)
  const b = assertRefName(base)
  const h = assertRefName(head)
  let mergeBase = b
  try {
    mergeBase = (await git(repo).raw(['merge-base', b, h])).trim() || b
  } catch {
    /* unrelated: compare against base itself */
  }
  return makeDiff(file, await readObject(repo, mergeBase, from ?? file), await readObject(repo, h, file))
}

/** Author names in the history, most active first (for the graph filter) */
export async function getAuthors(repo: string): Promise<string[]> {
  if (!(await hasHead(git(repo)))) return []
  const out = await git(repo).raw(['log', '--all', '--exclude=refs/stash', '--max-count=5000', '--format=%an'])
  const counts = new Map<string, number>()
  for (const name of out.split('\n').filter(Boolean)) counts.set(name, (counts.get(name) ?? 0) + 1)
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([n]) => n)
}

// ---------------------------------------------------------------------------
// Repository management: submodules, LFS, identity, .gitignore
// ---------------------------------------------------------------------------

export async function listSubmodules(repo: string): Promise<SubmoduleInfo[]> {
  const root = repoService.require(repo).path
  try {
    await fs.access(path.join(root, '.gitmodules'))
  } catch {
    return []
  }
  const g = git(repo)
  // submodule.<name>.path / .url from .gitmodules
  const cfg = await g.raw(['config', '-f', '.gitmodules', '--get-regexp', '^submodule\\..*\\.(path|url)$']).catch(() => '')
  const byPath = new Map<string, { name: string; url: string | null }>()
  const names = new Map<string, { path?: string; url?: string }>()
  for (const line of cfg.split('\n').filter(Boolean)) {
    const m = /^submodule\.(.+)\.(path|url) (.*)$/.exec(line)
    if (!m) continue
    const e = names.get(m[1]) ?? {}
    e[m[2] as 'path' | 'url'] = m[3]
    names.set(m[1], e)
  }
  for (const [name, e] of names) if (e.path) byPath.set(e.path, { name, url: e.url ?? null })
  const out = await g.raw(['submodule', 'status']).catch(() => '')
  const list: SubmoduleInfo[] = []
  for (const line of out.split('\n').filter(Boolean)) {
    // "-<sha> path" uninitialised, " <sha> path (desc)" ok, "+<sha> path" other commit checked out, "U..." conflict
    const m = /^([ +\-U])([0-9a-f]+) (.+?)(?: \(.*\))?$/.exec(line)
    if (!m) continue
    const info = byPath.get(m[3])
    list.push({
      name: info?.name ?? m[3],
      path: m[3],
      url: info?.url ?? null,
      commit: m[2],
      state: m[1] === '-' ? 'uninitialized' : m[1] === '+' ? 'changed' : m[1] === 'U' ? 'conflict' : 'ok',
    })
  }
  return list
}

/** Clone / check out submodules at the commits the repository expects (all, or one path) */
export async function updateSubmodules(repo: string, subPath?: string) {
  if (subPath !== undefined) safeJoin(repo, subPath)
  try {
    await netGit(repo).raw(['submodule', 'update', '--init', '--recursive', ...(subPath ? ['--', subPath] : [])])
  } catch (err) {
    throw friendlyRemoteError(err, 'fetch')
  }
}

export async function lfsInfo(repo: string): Promise<LfsInfo> {
  const g = git(repo)
  let version: string | null = null
  try {
    const out = (await g.raw(['lfs', 'version'])).trim()
    version = /git-lfs\/(\S+)/.exec(out)?.[1] ?? (out || null)
  } catch {
    /* not installed */
  }
  let files = 0
  try {
    // Files whose filter attribute is lfs — works whether or not git-lfs is installed
    files = (await g.raw(['ls-files', ':(attr:filter=lfs)'])).split('\n').filter(Boolean).length
  } catch {
    /* old git */
  }
  let used = files > 0
  if (!used) {
    try {
      used = /filter=lfs/.test(await fs.readFile(safeJoin(repo, '.gitattributes'), 'utf8'))
    } catch {
      /* no .gitattributes */
    }
  }
  return { used, installed: version !== null, version, files }
}

async function configGet(repo: string, key: string, scope?: '--local' | '--global'): Promise<string | null> {
  try {
    return (await git(repo).raw(['config', ...(scope ? [scope] : []), '--get', key])).trim() || null
  } catch {
    return null
  }
}

export async function getIdentity(repo: string): Promise<RepoIdentity> {
  const [ln, le, gn, ge] = await Promise.all([
    configGet(repo, 'user.name', '--local'),
    configGet(repo, 'user.email', '--local'),
    configGet(repo, 'user.name', '--global'),
    configGet(repo, 'user.email', '--global'),
  ])
  return { local: { name: ln, email: le }, inherited: { name: gn, email: ge } }
}

/** Set (or with an empty value, clear) this repository's own user.name / user.email */
export async function setIdentity(repo: string, name: string, email: string) {
  const g = git(repo)
  const clean = (v: unknown, what: string) => {
    const s = typeof v === 'string' ? v.trim() : ''
    if (/[\r\n\0]/.test(s)) throw new Error(`The ${what} can't contain line breaks`)
    return s
  }
  const n = clean(name, 'name')
  const e = clean(email, 'email')
  if (e && !/^[^\s@<>]+@[^\s@<>]+$/.test(e)) throw new Error(`"${e}" doesn't look like an email address`)
  for (const [key, value] of [['user.name', n], ['user.email', e]] as const) {
    if (value) await g.raw(['config', '--local', key, value])
    else if (await configGet(repo, key, '--local')) await g.raw(['config', '--local', '--unset', key])
  }
}

export async function readGitignore(repo: string): Promise<string> {
  try {
    return await fs.readFile(safeJoin(repo, '.gitignore'), 'utf8')
  } catch {
    return ''
  }
}

export async function writeGitignore(repo: string, content: string) {
  if (typeof content !== 'string') throw new Error('Invalid .gitignore content')
  if (content.length > MAX_DIFF_BYTES) throw new Error('.gitignore is too large')
  await fs.writeFile(safeJoin(repo, '.gitignore'), content, 'utf8')
}

/** Add a pattern (e.g. an untracked file's path) to the root .gitignore */
export async function addToGitignore(repo: string, pattern: string) {
  const p = typeof pattern === 'string' ? pattern.trim() : ''
  if (!p || /[\r\n\0]/.test(p)) throw new Error('Invalid ignore pattern')
  const current = await readGitignore(repo)
  if (current.split(/\r?\n/).some((l) => l.trim() === p)) return
  const eol = current.includes('\r\n') ? '\r\n' : '\n'
  await writeGitignore(repo, current + (current && !current.endsWith('\n') ? eol : '') + p + eol)
}

/** Would `file` be ignored, and by which rule? */
export async function checkIgnore(repo: string, file: string): Promise<IgnoreCheck> {
  const p = typeof file === 'string' ? file.trim().replace(/\\/g, '/') : ''
  if (!p) throw new Error('Enter a path to test')
  safeJoin(repo, p)
  const g = git(repo)
  const tracked = !!(await g.raw(['ls-files', '--', p]).catch(() => '')).trim()
  // --no-index: also answer for files that are tracked (rules would apply if they weren't)
  const out = (await g.raw(['check-ignore', '-v', '--no-index', '--', p]).catch(() => '')).trim()
  // "<source>:<line>:<pattern>\t<path>"
  const m = /^(.*):(\d+):(.*)\t/.exec(out)
  if (!m) return { ignored: false, rule: null, tracked }
  const rule = { source: m[1], line: Number(m[2]), pattern: m[3] }
  return { ignored: !rule.pattern.startsWith('!'), rule, tracked }
}

// ---------------------------------------------------------------------------
// Undo / redo
// ---------------------------------------------------------------------------

export function getHistory(repo: string): HistoryState {
  repoService.require(repo)
  return history.state(repo)
}

function stale(op: Op, why: string): never {
  throw new StaleOperationError(`Can't reverse the ${describe(op)}: ${why}`)
}

async function expectBranch(repo: string, op: Op, branch: string | null) {
  const cur = await currentBranch(repo)
  if (cur !== branch) stale(op, `expected to be on ${branch ?? 'a detached HEAD'} but on ${cur ?? 'a detached HEAD'}`)
}
async function expectHead(repo: string, op: Op, hash: string | null) {
  const head = await headHash(repo)
  if (head !== hash) stale(op, 'the branch has moved since')
}

/** Move a branch (or detached HEAD) without touching the index or working tree, guarded by its old value */
async function moveRef(repo: string, branch: string | null, to: string | null, expectedOld: string | null) {
  const g = git(repo)
  if (!branch) {
    await g.raw(['update-ref', '--no-deref', 'HEAD', to!, expectedOld ?? ''])
  } else if (to) {
    await g.raw(['update-ref', `refs/heads/${branch}`, to, expectedOld ?? ''])
  } else {
    await g.raw(['update-ref', '-d', `refs/heads/${branch}`, expectedOld ?? ''])
  }
}

async function switchTo(repo: string, target: string, detached: boolean) {
  await git(repo).raw(detached ? ['switch', '--detach', target] : ['switch', target])
}

async function reverse(repo: string, op: Op) {
  const g = git(repo)
  switch (op.kind) {
    case 'commit':
      // Like `git reset --soft HEAD~1`: the commit's changes stay staged
      await expectBranch(repo, op, op.branch)
      await expectHead(repo, op, op.hash)
      await moveRef(repo, op.branch, op.parent, op.hash)
      return
    case 'checkout':
      await expectBranch(repo, op, op.to)
      if (op.ff) {
        await expectHead(repo, op, op.ff.after)
        await g.raw(['reset', '--keep', op.ff.before])
      }
      await switchTo(repo, op.from, op.fromDetached)
      if (op.created) await g.raw(['branch', '-D', '--', op.to])
      return
    case 'createBranch': {
      const tip = await refHash(repo, `refs/heads/${op.name}`)
      if (tip !== op.hash) stale(op, `'${op.name}' has new commits or no longer exists`)
      if (op.checkedOut) {
        await expectBranch(repo, op, op.name)
        if (op.prev) await switchTo(repo, op.prev, op.prevDetached)
      }
      await g.raw(['branch', '-D', '--', op.name])
      return
    }
    case 'deleteBranch':
      if (await refHash(repo, `refs/heads/${op.name}`)) stale(op, `a branch named '${op.name}' exists again`)
      await g.raw(['branch', op.name, op.hash])
      return
    case 'headMove':
      await expectBranch(repo, op, op.branch)
      await expectHead(repo, op, op.after)
      await g.raw(['reset', '-q', `--${op.mode}`, op.before])
      return
    case 'dropStash':
      if ((await getStashes(repo)).some((st) => st.commit === op.hash)) stale(op, 'that stash is already in the list')
      await g.raw(['stash', 'store', '-m', op.message, op.hash])
      return
    case 'deleteTag':
      if (await refHash(repo, `refs/tags/${op.name}`)) stale(op, `a tag named '${op.name}' exists again`)
      // update-ref restores annotated tags exactly (same tag object, message and tagger)
      await g.raw(['update-ref', `refs/tags/${op.name}`, op.object, ''])
      return
    case 'pull':
    case 'merge':
      await expectBranch(repo, op, op.branch)
      await expectHead(repo, op, op.after)
      // --keep refuses instead of overwriting local changes
      await g.raw(['reset', '--keep', op.before])
      return
  }
}

async function reapply(repo: string, op: Op) {
  const g = git(repo)
  switch (op.kind) {
    case 'commit':
      await expectBranch(repo, op, op.branch)
      await expectHead(repo, op, op.parent)
      await moveRef(repo, op.branch, op.hash, op.parent)
      return
    case 'checkout':
      if (op.fromDetached) await expectHead(repo, op, op.from)
      else await expectBranch(repo, op, op.from)
      if (op.created) await g.raw(['switch', '-c', op.to, '--track', op.created.upstream])
      else await g.raw(['switch', op.to])
      if (op.ff) {
        await expectHead(repo, op, op.ff.before)
        await g.raw(['merge', '--ff-only', '--quiet', op.ff.after])
      }
      return
    case 'createBranch':
      if (await refHash(repo, `refs/heads/${op.name}`)) stale(op, `a branch named '${op.name}' already exists`)
      await g.raw(['branch', op.name, op.hash])
      if (op.checkedOut) await g.raw(['switch', op.name])
      return
    case 'deleteBranch': {
      const tip = await refHash(repo, `refs/heads/${op.name}`)
      if (tip !== op.hash) stale(op, `'${op.name}' has changed since`)
      if ((await currentBranch(repo)) === op.name) stale(op, `'${op.name}' is checked out`)
      await g.raw(['branch', '-D', '--', op.name])
      return
    }
    case 'headMove':
      await expectBranch(repo, op, op.branch)
      await expectHead(repo, op, op.before)
      await g.raw(['reset', '-q', `--${op.mode}`, op.after])
      return
    case 'dropStash': {
      const st = (await getStashes(repo)).find((x) => x.commit === op.hash)
      if (!st) stale(op, 'that stash is no longer in the list')
      await g.raw(['stash', 'drop', '-q', st.ref])
      return
    }
    case 'deleteTag': {
      let cur = ''
      try {
        cur = (await g.raw(['rev-parse', '--verify', '--quiet', `refs/tags/${op.name}`])).trim()
      } catch {
        /* missing */
      }
      if (cur !== op.object) stale(op, `'${op.name}' has changed since`)
      await g.raw(['tag', '-d', '--', op.name])
      return
    }
    case 'pull':
    case 'merge':
      await expectBranch(repo, op, op.branch)
      await expectHead(repo, op, op.before)
      await g.raw(['reset', '--keep', op.after])
      return
  }
}

async function assertNoOperation(repo: string, action: string) {
  const op = await getOperation(repo)
  if (op) throw new Error(`Can't ${action} while a ${OPERATION_LABEL[op.kind]} is in progress — finish or abort it first`)
}

/** Undo the latest operation. Returns its description. */
export async function undo(repo: string): Promise<string> {
  const op = history.peekUndo(repo)
  if (!op) throw new Error('Nothing to undo')
  await assertNoOperation(repo, 'undo')
  try {
    await reverse(repo, op)
  } catch (err) {
    // The repository changed outside Gitfy: this operation can never be undone safely, so forget it
    if (err instanceof StaleOperationError) history.dropUndo(repo)
    throw err
  }
  history.undone(repo)
  return describe(op)
}

/** Redo the latest undone operation. Returns its description. */
export async function redo(repo: string): Promise<string> {
  const op = history.peekRedo(repo)
  if (!op) throw new Error('Nothing to redo')
  await assertNoOperation(repo, 'redo')
  try {
    await reapply(repo, op)
  } catch (err) {
    if (err instanceof StaleOperationError) history.dropRedo(repo)
    throw err
  }
  history.redone(repo)
  return describe(op)
}
