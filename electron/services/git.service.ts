import fs from 'node:fs/promises'
import path from 'node:path'
import { simpleGit, type SimpleGit, type StatusResult } from 'simple-git'
import type {
  Branch,
  BranchList,
  Commit,
  CommitFile,
  CheckoutResult,
  CommitRef,
  DiffContent,
  FileChange,
  FileChangeType,
  HistoryState,
  PullMode,
  PullResult,
  PushResult,
  RemoteInfo,
  RepoStatus,
  StashRef,
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
    await g.raw(['rev-parse', '--verify', '--quiet', 'HEAD'])
    return true
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

function toRepoStatus(s: StatusResult): RepoStatus {
  const staged: FileChange[] = []
  const unstaged: FileChange[] = []
  const conflicted = new Set(s.conflicted)

  for (const f of s.files) {
    const x = f.index
    const y = f.working_dir
    if (conflicted.has(f.path)) {
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

  const byPath = (a: FileChange, b: FileChange) => a.path.localeCompare(b.path)
  return {
    branch: s.current,
    tracking: s.tracking,
    ahead: s.ahead,
    behind: s.behind,
    detached: s.detached,
    staged: staged.sort(byPath),
    unstaged: unstaged.sort(byPath),
    conflicted: s.conflicted,
  }
}

export async function getStatus(repo: string): Promise<RepoStatus> {
  return toRepoStatus(await git(repo).status(['--untracked-files=all']))
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

export async function getLog(repo: string, limit = LOG_LIMIT): Promise<Commit[]> {
  const g = git(repo)
  if (!(await hasHead(g))) return []
  const out = await g.raw([
    'log',
    '--exclude=refs/stash',
    '--all',
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

export async function getCommitFiles(repo: string, hash: string): Promise<CommitFile[]> {
  assertHash(hash)
  const parent = await firstParent(repo, hash)
  const out = parent
    ? await git(repo).raw(['diff', '--name-status', '-M', parent, hash])
    : await git(repo).raw(['diff-tree', '--root', '--no-commit-id', '-r', '-M', '--name-status', hash])
  return out
    .split('\n')
    .filter(Boolean)
    .map((line) => {
      const [status, a, b] = line.split('\t')
      return b ? { status: status[0], from: a, path: b } : { status: status[0], path: a }
    })
}

export async function getCommitFileDiff(repo: string, hash: string, file: string, from?: string): Promise<DiffContent> {
  assertHash(hash)
  safeJoin(repo, file)
  if (from) safeJoin(repo, from)
  const parent = await firstParent(repo, hash)
  const original = parent ? await readObject(repo, parent, from ?? file) : EMPTY
  const modified = await readObject(repo, hash, file)
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

export async function addRemote(repo: string, name: string, url: string) {
  repoService.require(repo)
  name = typeof name === 'string' ? name.trim() : ''
  url = typeof url === 'string' ? url.trim() : ''
  if (!name) throw new Error('Remote name is required')
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(name) || name.endsWith('.lock') || name.includes('..')) {
    throw new Error(`"${name}" is not a valid remote name`)
  }
  if (!url) throw new Error('Remote URL is required')
  // Reject option injection, whitespace/control characters and transport helpers like ext::<command>
  if (url.startsWith('-') || /[\s\x00-\x1f]/.test(url) || /^[A-Za-z][A-Za-z0-9+.-]*::/.test(url)) {
    throw new Error('That does not look like a valid remote URL')
  }
  const existing = await getRemotes(repo)
  if (existing.some((r) => r.name === name)) throw new Error(`A remote named "${name}" already exists`)
  await git(repo).raw(['remote', 'add', '--', name, url])
}

function netGit(repo: string): SimpleGit {
  return netGitAt(repoService.require(repo).path)
}

export async function fetchAll(repo: string) {
  try {
    await netGit(repo).raw(['fetch', '--all'])
  } catch (err) {
    throw friendlyRemoteError(err, 'fetch')
  }
}

export async function pull(repo: string, mode: PullMode = 'ff'): Promise<PullResult> {
  const branch = await currentBranch(repo)
  if (!branch) throw new Error('Cannot pull with a detached HEAD — switch to a branch first')
  const before = await headHash(repo)
  try {
    // --no-edit: never wait for an editor to write a merge commit message
    await netGit(repo).raw(['pull', '--no-edit', mode === 'ff-only' ? '--ff-only' : '--no-rebase'])
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/no tracking information/i.test(msg)) {
      throw new Error(`'${branch}' has no upstream branch to pull from. Push it first to create one.`)
    }
    if (/Not possible to fast-forward|diverging branches/i.test(msg)) {
      throw new Error(`'${branch}' and its upstream have diverged, so a fast-forward-only pull isn't possible. Use "Pull (fast-forward if possible)" to merge.`)
    }
    if (/CONFLICT|Automatic merge failed/i.test(msg)) {
      throw new Error(`Pull stopped with merge conflicts. Resolve the conflicted files, stage them and commit to finish the merge.\n\n${msg}`)
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

export async function push(repo: string): Promise<PushResult> {
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
  if (upstreamRemote && upstreamMerge && upstreamRemote !== '.') {
    remote = upstreamRemote
    args = ['push', remote, `HEAD:${upstreamMerge}`]
  } else {
    const remotes = (await g.raw(['remote'])).split('\n').map((r) => r.trim()).filter(Boolean)
    if (remotes.length === 0) throw new Error('This repository has no remote to push to')
    remote = remotes.includes('origin') ? 'origin' : remotes[0]
    setUpstream = true
    args = ['push', '--set-upstream', remote, branch]
  }
  try {
    await netGit(repo).raw(args)
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err)
    if (/rejected/i.test(msg) && /(non-fast-forward|fetch first|behind)/i.test(msg)) {
      throw new Error(`Push rejected: ${remote} has commits that '${branch}' doesn't have yet. Pull first, then push again.`)
    }
    throw friendlyRemoteError(err, 'push')
  }
  // Pushed commits are shared now — undoing local history past this point would diverge from the remote
  history.clear(repo)
  return { branch, remote, setUpstream }
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
    case 'pull':
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
    case 'pull':
      await expectBranch(repo, op, op.branch)
      await expectHead(repo, op, op.before)
      await g.raw(['reset', '--keep', op.after])
      return
  }
}

/** Undo the latest operation. Returns its description. */
export async function undo(repo: string): Promise<string> {
  const op = history.peekUndo(repo)
  if (!op) throw new Error('Nothing to undo')
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
  try {
    await reapply(repo, op)
  } catch (err) {
    if (err instanceof StaleOperationError) history.dropRedo(repo)
    throw err
  }
  history.redone(repo)
  return describe(op)
}
