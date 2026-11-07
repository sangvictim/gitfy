import { app } from 'electron'
import fs from 'node:fs/promises'
import path from 'node:path'
import { CheckRepoActions, simpleGit } from 'simple-git'
import type { OpenTabs, RepoInfo } from '../../src/types/git'
import { friendlyRemoteError, netGitAt } from './net'

const MAX_RECENT = 10

/**
 * Tracks the repositories open in tabs and the list of recently opened ones.
 * Git commands only ever run against a repository registered here through open / init /
 * clone, so the renderer cannot point git at an arbitrary folder.
 */
class RepoService {
  /** Open repositories keyed by their root path */
  private opened = new Map<string, RepoInfo>()

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
    const root = (await git.revparse(['--show-toplevel'])).trim()
    const repo: RepoInfo = { path: root, name: path.basename(root) }
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
    await fs.mkdir(path.dirname(this.tabsFile), { recursive: true })
    await fs.writeFile(this.tabsFile, JSON.stringify({ repos, active }, null, 2))
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

  async removeRecent(repoPath: string): Promise<RepoInfo[]> {
    const list = (await this.getRecent()).filter((r) => r.path !== repoPath)
    await this.saveRecent(list)
    return list
  }

  private async addRecent(repo: RepoInfo) {
    const list = (await this.getRecent()).filter((r) => r.path !== repo.path)
    list.unshift(repo)
    await this.saveRecent(list.slice(0, MAX_RECENT))
  }

  private async saveRecent(list: RepoInfo[]) {
    await fs.mkdir(path.dirname(this.recentFile), { recursive: true })
    await fs.writeFile(this.recentFile, JSON.stringify(list, null, 2))
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
