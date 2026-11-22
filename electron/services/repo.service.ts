import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CheckRepoActions, simpleGit } from 'simple-git'
import type { OpenTabs, RepoInfo } from '../../src/types/git'
import { serial, writeFileAtomic } from './fsutil'
import { friendlyRemoteError, netGitAt } from './net'

const MAX_RECENT = 10

/**
 * Filter programs a repository's own config may use: git-lfs, git-crypt and git-annex write theirs
 * there (e.g. `git lfs install --local`, `git-crypt init`). Only by bare name (found on PATH, never a
 * path that could point into the repository itself) and with plain arguments — no shell syntax.
 */
const KNOWN_FILTER = /^"?(?:git-lfs|git-crypt|git-annex)"?(?: [\w%.=-]+)*$/

/**
 * Filter drivers set in the repository's own config (.git/config and what it includes). `git status`
 * runs their programs, so a repository from a zip / shared drive could run code just by being opened
 * in Gitfy. Switch them off for Gitfy's commands; drivers from the user's global config are untouched.
 */
async function localFilterOverrides(root: string): Promise<string[]> {
  const out = await simpleGit(root)
    .raw(['config', '--local', '--includes', '--get-regexp', '^filter\\..+\\.(clean|smudge|process)$'])
    .catch(() => '')
  const drivers = new Set<string>()
  for (const line of out.split('\n')) {
    const m = /^filter\.(.+)\.(clean|smudge|process) (.*)$/.exec(line)
    if (m && !KNOWN_FILTER.test(m[3].trim())) drivers.add(m[1])
  }
  return [...drivers].flatMap((d) => [`filter.${d}.clean=`, `filter.${d}.smudge=`, `filter.${d}.process=`, `filter.${d}.required=false`])
}

/**
 * One spelling per repository, used as its key everywhere (and checked against in safeJoin):
 * Git for Windows prints C:/x/repo while Node paths are C:\\x\\repo, and on macOS the same
 * folder can be reached as /Users/me/Repo or /users/me/repo.
 */
async function canonicalRoot(root: string): Promise<string> {
  const abs = path.resolve(root)
  if (process.platform !== 'darwin') return abs
  return fs.realpath(abs).catch(() => abs) // fs/promises realpath is the native one: on-disk case
}

/**
 * Tracks the repositories open in tabs and the list of recently opened ones.
 * Git commands only ever run against a repository registered here through open / init /
 * clone, so the renderer cannot point git at an arbitrary folder.
 */
class RepoService {
  /** Open repositories keyed by their root path */
  private opened = new Map<string, RepoInfo>()
  /** Per repository: -c settings that switch off filter programs its own .git/config defines */
  private overrides = new Map<string, string[]>()
  /** recent-repos.json / open-tabs.json updates, one at a time */
  private queue = serial()

  private get recentFile() {
    return path.join(app.getPath('userData'), 'recent-repos.json')
  }

  private get tabsFile() {
    return path.join(app.getPath('userData'), 'open-tabs.json')
  }

  /** The open repository at `repoPath`; throws if it was never opened (or was closed) */
  require(repoPath: string): RepoInfo {
    const repo = typeof repoPath === 'string' ? this.opened.get(repoPath) : undefined
    if (!repo) throw new Error('This repository is not open')
    return repo
  }

  /** `remember: false` reopens without touching the recent list (used when restoring tabs) */
  async open(dir: string, remember = true): Promise<RepoInfo> {
    const abs = path.resolve(dir)
    await this.assertDirectory(abs)
    const git = simpleGit(abs)
    if (!(await git.checkIsRepo())) {
      throw new Error(`"${abs}" is not a Git repository`)
    }
    const root = await canonicalRoot((await git.revparse(['--show-toplevel'])).trim())
    const repo: RepoInfo = { path: root, name: path.basename(root) }
    this.overrides.set(root, await localFilterOverrides(root))
    this.opened.set(root, repo)
    if (remember) await this.addRecent(repo)
    return repo
  }

  async init(dir: string): Promise<RepoInfo> {
    const abs = path.resolve(dir)
    await fs.mkdir(abs, { recursive: true })
    const git = simpleGit(abs)
    if (await git.checkIsRepo(CheckRepoActions.IS_REPO_ROOT)) {
      throw new Error(`"${abs}" is already a Git repository`)
    }
    await git.init()
    return this.open(abs)
  }

  async clone(url: string, parentDir: string, folderName?: string): Promise<RepoInfo> {
    const trimmed = url.trim()
    if (!trimmed) throw new Error('Repository URL is required')
    // Like remote URLs: no option-like URLs, control characters or transport helpers (ext::<command>)
    if (trimmed.startsWith('-') || /[\x00-\x1f]/.test(trimmed) || /^[A-Za-z][A-Za-z0-9+.-]*::/.test(trimmed)) {
      throw new Error('That does not look like a valid repository URL')
    }
    const name = (folderName?.trim() || deriveRepoName(trimmed))
    if (!name || name.includes('/') || name.includes('\\') || name === '.' || name === '..') {
      throw new Error('Invalid destination folder name')
    }
    const parent = path.resolve(parentDir)
    await this.assertDirectory(parent)
    const target = path.join(parent, name)
    if (await exists(target)) {
      const entries = await fs.readdir(target)
      if (entries.length > 0) throw new Error(`Destination "${target}" already exists and is not empty`)
    }
    // `--` guards against URLs that look like options
    try {
      await netGitAt(parent).clone(trimmed, target, ['--'])
    } catch (err) {
      throw friendlyRemoteError(err, 'clone')
    }
    return this.open(target)
  }

  close(repoPath: string) {
    this.opened.delete(repoPath)
    this.overrides.delete(repoPath)
  }

  extraConfig(root: string): string[] {
    return this.overrides.get(root) ?? []
  }

  /** Repositories that were open in tabs when the app was last used */
  async getOpenTabs(): Promise<OpenTabs> {
    try {
      const data = JSON.parse(await fs.readFile(this.tabsFile, 'utf8'))
      const repos = Array.isArray(data?.repos) ? data.repos.filter((p: unknown) => typeof p === 'string') : []
      const active = typeof data?.active === 'string' ? data.active : null
      return { repos, active }
    } catch {
      return { repos: [], active: null }
    }
  }

  async saveOpenTabs(tabs: OpenTabs) {
    const repos = Array.isArray(tabs?.repos) ? [...new Set(tabs.repos.filter((p) => typeof p === 'string'))] : []
    const active = typeof tabs?.active === 'string' && repos.includes(tabs.active) ? tabs.active : null
    // In call order, so the last state the renderer sent is the one that stays
    await this.queue(() => writeFileAtomic(this.tabsFile, JSON.stringify({ repos, active }, null, 2)))
  }

  async getRecent(): Promise<RepoInfo[]> {
    try {
      const raw = await fs.readFile(this.recentFile, 'utf8')
      const list = JSON.parse(raw)
      return Array.isArray(list) ? list.filter((r) => r && typeof r.path === 'string') : []
    } catch {
      return []
    }
  }

  removeRecent(repoPath: string): Promise<RepoInfo[]> {
    return this.queue(async () => {
      const list = (await this.getRecent()).filter((r) => r.path !== repoPath)
      await this.saveRecent(list)
      return list
    })
  }

  private addRecent(repo: RepoInfo) {
    return this.queue(async () => {
      const list = (await this.getRecent()).filter((r) => r.path !== repo.path)
      list.unshift(repo)
      await this.saveRecent(list.slice(0, MAX_RECENT))
    })
  }

  private async saveRecent(list: RepoInfo[]) {
    await writeFileAtomic(this.recentFile, JSON.stringify(list, null, 2))
  }

  private async assertDirectory(dir: string) {
    const stat = await fs.stat(dir).catch(() => null)
    if (!stat?.isDirectory()) throw new Error(`"${dir}" is not a directory`)
  }
}

function deriveRepoName(url: string): string {
  const last = url.replace(/[\\/]+$/, '').split(/[\\/:]/).pop() ?? ''
  return last.replace(/\.git$/, '')
}

async function exists(p: string) {
  return fs
    .access(p)
    .then(() => true)
    .catch(() => false)
}

export const repoService = new RepoService()
