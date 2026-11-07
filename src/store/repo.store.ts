import { useMemo } from 'react'
import { create } from 'zustand'
import { gitFor, ipc } from '../services/ipc'
import type { BranchList, Commit, HistoryState, PullMode, RepoInfo, RepoStatus } from '../types/git'
import { toast } from './toast.store'

/** What the right-hand panel shows: the working copy ("wip"), a commit hash, or nothing */
export type Selection = 'wip' | string | null

/** What the centre area shows instead of the graph */
export type DiffTarget =
  | { kind: 'working'; path: string; staged: boolean; from?: string }
  | { kind: 'commit'; hash: string; path: string; from?: string }

/** Everything that belongs to one tab */
interface Session {
  /** null = an empty "New Tab" showing the welcome screen */
  repo: RepoInfo | null
  status: RepoStatus | null
  branches: BranchList | null
  commits: Commit[]
  selected: Selection
  openDiff: DiffTarget | null
  /** Bumped to ask the graph to scroll a commit into view */
  focusRequest: { hash: string; n: number } | null
  /** Commit search text ('' = search inactive) */
  search: string
  /** What Undo / Redo would do right now */
  history: HistoryState
}

export interface Tab {
  id: string
  repo: RepoInfo | null
}

/**
 * The active tab's session is spread at the top level (so components read `status`, `commits`…
 * directly); inactive tabs are parked in `parked`. Async results are always written back to the
 * tab that started the request, even if the user switched tabs in the meantime.
 */
interface RepoState extends Session {
  tabs: Tab[]
  activeTabId: string
  parked: Record<string, Session>
  recent: RepoInfo[]
  /** Label of a long-running operation (clone, checkout...) or null */
  busy: string | null

  /** Reopen the repositories that were in tabs when the app was last closed (call once at startup) */
  restoreTabs: () => Promise<void>
  newTab: () => void
  switchTab: (id: string) => void
  closeTab: (id: string) => Promise<void>

  select: (s: Selection) => void
  setOpenDiff: (d: DiffTarget | null) => void
  focusCommit: (hash: string) => void
  setSearch: (q: string) => void

  loadRecent: () => Promise<void>
  removeRecent: (path: string) => Promise<void>
  openRepo: (dir: string) => Promise<boolean>
  initRepo: (dir: string) => Promise<boolean>
  cloneRepo: (url: string, parent: string, name?: string) => Promise<boolean>

  refreshStatus: () => Promise<void>
  refreshBranches: () => Promise<void>
  refreshLog: () => Promise<void>
  refreshAll: () => Promise<void>

  stage: (files: string[]) => Promise<void>
  unstage: (files: string[]) => Promise<void>
  stageAll: () => Promise<void>
  unstageAll: () => Promise<void>
  /** Commit staged changes; with `newBranch`, on a new branch created from the current position */
  commit: (summary: string, description: string, newBranch?: string) => Promise<boolean>

  checkout: (name: string, remote?: boolean) => Promise<void>
  createBranch: (name: string, checkout: boolean) => Promise<boolean>
  addRemote: (name: string, url: string) => Promise<boolean>
  deleteBranch: (name: string, force: boolean) => Promise<boolean>

  fetchAll: () => Promise<void>
  pull: (mode?: PullMode) => Promise<void>
  push: () => Promise<void>
  undo: () => Promise<void>
  redo: () => Promise<void>
}

const emptySession = (repo: RepoInfo | null = null): Session => ({
  repo,
  status: null,
  branches: null,
  commits: [],
  selected: null,
  openDiff: null,
  focusRequest: null,
  search: '',
  history: { undo: null, redo: null },
})

const SESSION_KEYS = Object.keys(emptySession()) as (keyof Session)[]
const pickSession = (s: Session): Session =>
  Object.fromEntries(SESSION_KEYS.map((k) => [k, s[k]])) as unknown as Session

/** Run an IPC call, surfacing failures as an error toast. Returns undefined on failure. */
async function attempt<T>(fn: () => Promise<T>): Promise<T | undefined> {
  try {
    return await fn()
  } catch (err) {
    toast.error(err instanceof Error ? err.message : String(err))
    return undefined
  }
}

let tabCounter = 0
/** Single in-flight restore (React StrictMode runs mount effects twice in dev) */
let restoring: Promise<void> | null = null
/** Don't persist tabs until the saved ones were restored, or the empty start-up state would overwrite them */
let tabsRestored = false

/** Persist the repositories open in tabs so the next launch can continue where the user left off */
function saveTabs() {
  if (!tabsRestored) return
  const s = useRepoStore.getState()
  const repos = s.tabs.flatMap((t) => (t.repo ? [t.repo.path] : []))
  const active = s.repo?.path ?? null
  ipc.saveOpenTabs({ repos, active }).catch((err) => console.warn('saving tabs failed', err))
}
let focusCounter = 0
const newTabId = () => `tab-${++tabCounter}`

const firstTabId = newTabId()

export const useRepoStore = create<RepoState>((set, get) => {
  /** Current session of any tab (active or parked) */
  const sessionOf = (tabId: string): Session | undefined =>
    tabId === get().activeTabId ? pickSession(get()) : get().parked[tabId]

  /** Apply changes to a tab's session, wherever it currently lives */
  const patch = (tabId: string, partial: Partial<Session>) => {
    const s = get()
    const tabs = 'repo' in partial ? s.tabs.map((t) => (t.id === tabId ? { ...t, repo: partial.repo ?? null } : t)) : s.tabs
    if (tabId === s.activeTabId) set({ ...partial, tabs })
    else if (s.parked[tabId]) set({ parked: { ...s.parked, [tabId]: { ...s.parked[tabId], ...partial } }, tabs })
    // tab was closed meanwhile → drop the result
  }

  /** Git client for the active tab, plus its id so results land in the right tab */
  const active = () => {
    const s = get()
    return s.repo ? { tabId: s.activeTabId, git: gitFor(s.repo.path) } : null
  }
  const gitOfTab = (tabId: string) => {
    const repo = sessionOf(tabId)?.repo
    return repo ? gitFor(repo.path) : null
  }

  /** Keep an open working-copy diff valid after the file lists change */
  const reconcileDiff = (tabId: string, status: RepoStatus) => {
    const d = sessionOf(tabId)?.openDiff
    if (!d || d.kind !== 'working') return
    const list = d.staged ? status.staged : status.unstaged
    if (list.some((f) => f.path === d.path)) return
    // File moved to the other list (e.g. just staged) — follow it
    const other = d.staged ? status.unstaged : status.staged
    const moved = other.find((f) => f.path === d.path)
    patch(tabId, { openDiff: moved ? { kind: 'working', path: moved.path, staged: !d.staged, from: moved.from } : null })
  }

  const loadStatus = async (tabId: string) => {
    const git = gitOfTab(tabId)
    if (!git) return
    try {
      const status = await git.status()
      patch(tabId, { status })
      reconcileDiff(tabId, status)
    } catch (err) {
      // Polling: don't spam toasts, but keep last known state
      console.warn('status failed', err)
    }
  }
  const loadBranches = async (tabId: string) => {
    const git = gitOfTab(tabId)
    if (!git) return
    const branches = await attempt(git.branches)
    if (branches) patch(tabId, { branches })
  }
  const loadLog = async (tabId: string) => {
    const git = gitOfTab(tabId)
    if (!git) return
    const commits = await attempt(() => git.log())
    if (commits) patch(tabId, { commits })
  }
  const loadHistory = async (tabId: string) => {
    const git = gitOfTab(tabId)
    if (!git) return
    try {
      patch(tabId, { history: await git.history() })
    } catch {
      /* repo closed meanwhile */
    }
  }
  const loadAll = (tabId: string) =>
    Promise.all([loadStatus(tabId), loadBranches(tabId), loadLog(tabId), loadHistory(tabId)]).then(() => {})

  /** Show a freshly opened repo: reuse its tab if already open, else the empty active tab, else a new tab */
  const placeRepo = async (repo: RepoInfo) => {
    const s = get()
    const existing = s.tabs.find((t) => t.repo?.path === repo.path)
    if (existing) {
      get().switchTab(existing.id)
      return
    }
    if (!s.repo) {
      patch(s.activeTabId, emptySession(repo))
    } else {
      get().newTab()
      patch(get().activeTabId, emptySession(repo))
    }
    await Promise.all([loadAll(get().activeTabId), get().loadRecent()])
  }

  const withBusy = async <T>(label: string, fn: () => Promise<T>) => {
    set({ busy: label })
    try {
      return await attempt(fn)
    } finally {
      set({ busy: null })
    }
  }

  return {
    ...emptySession(),
    tabs: [{ id: firstTabId, repo: null }],
    activeTabId: firstTabId,
    parked: {},
    recent: [],
    busy: null,

    // ---- tabs -------------------------------------------------------------
    restoreTabs: () => (restoring ??= (async () => {
      try {
        const saved = await attempt(ipc.getOpenTabs)
        if (!saved?.repos.length) return
        set({ busy: 'Restoring tabs…' })
        const opened: RepoInfo[] = []
        const missing: string[] = []
        for (const p of saved.repos) {
          try {
            opened.push(await ipc.openRepo(p, false)) // don't reshuffle the recent list
          } catch {
            missing.push(p)
          }
        }
        if (missing.length) toast.error(`Could not reopen (moved or deleted?):\n${missing.join('\n')}`)
        if (!opened.length) return

        // Only the active tab loads now; the others load when first switched to
        const tabs = opened.map((repo) => ({ id: newTabId(), repo }))
        const activeIdx = Math.max(0, opened.findIndex((r) => r.path === saved.active))
        const parked = Object.fromEntries(
          tabs.filter((_, i) => i !== activeIdx).map((t) => [t.id, emptySession(t.repo)]),
        )
        set({ ...emptySession(opened[activeIdx]), tabs, activeTabId: tabs[activeIdx].id, parked })
        await loadAll(tabs[activeIdx].id)
      } finally {
        set({ busy: null })
        tabsRestored = true
        saveTabs() // drop entries that could not be reopened
      }
    })()),
    newTab: () => {
      const s = get()
      const id = newTabId()
      set({
        ...emptySession(),
        tabs: [...s.tabs, { id, repo: null }],
        activeTabId: id,
        parked: { ...s.parked, [s.activeTabId]: pickSession(s) },
      })
    },
    switchTab: (id) => {
      const s = get()
      if (id === s.activeTabId || !s.parked[id]) return
      const { [id]: target, ...rest } = s.parked
      set({ ...target, activeTabId: id, parked: { ...rest, [s.activeTabId]: pickSession(s) } })
      // The tab may be stale (files edited while it was in the background)
      loadAll(id)
    },
    closeTab: async (id) => {
      const s = get()
      const session = sessionOf(id)
      if (session?.repo) ipc.closeRepo(session.repo.path).catch(() => {})
      const idx = s.tabs.findIndex((t) => t.id === id)
      const tabs = s.tabs.filter((t) => t.id !== id)
      const { [id]: _closed, ...parked } = s.parked

      if (id !== s.activeTabId) {
        set({ tabs, parked })
        return
      }
      if (tabs.length === 0) {
        // Closing the last tab leaves an empty New Tab
        const fresh = newTabId()
        set({ ...emptySession(), tabs: [{ id: fresh, repo: null }], activeTabId: fresh, parked: {} })
        await get().loadRecent()
        return
      }
      const next = tabs[Math.min(idx, tabs.length - 1)]
      const { [next.id]: target, ...others } = parked
      set({ ...target, tabs, activeTabId: next.id, parked: others })
      loadAll(next.id)
    },

    // ---- view state ---------------------------------------------------------
    select: (selected) => set({ selected, openDiff: null }),
    setOpenDiff: (openDiff) => set({ openDiff }),
    focusCommit: (hash) => set({ selected: hash, openDiff: null, focusRequest: { hash, n: ++focusCounter } }),
    setSearch: (search) => set({ search }),

    // ---- repositories -------------------------------------------------------
    loadRecent: async () => {
      const recent = await attempt(ipc.recentRepos)
      if (recent) set({ recent })
    },
    removeRecent: async (path) => {
      const recent = await attempt(() => ipc.removeRecent(path))
      if (recent) set({ recent })
    },
    openRepo: async (dir) => {
      const repo = await withBusy('Opening repository…', () => ipc.openRepo(dir))
      if (!repo) return false
      await placeRepo(repo)
      return true
    },
    initRepo: async (dir) => {
      const repo = await withBusy('Initializing repository…', () => ipc.initRepo(dir))
      if (!repo) return false
      toast.success(`Initialized empty repository in ${repo.path}`)
      await placeRepo(repo)
      return true
    },
    cloneRepo: async (url, parent, name) => {
      const repo = await withBusy('Cloning repository…', () => ipc.cloneRepo(url, parent, name))
      if (!repo) return false
      toast.success(`Cloned into ${repo.path}`)
      await placeRepo(repo)
      return true
    },

    // ---- refresh (active tab) -----------------------------------------------
    refreshStatus: () => loadStatus(get().activeTabId),
    refreshBranches: () => loadBranches(get().activeTabId),
    refreshLog: () => loadLog(get().activeTabId),
    refreshAll: () => loadAll(get().activeTabId),

    // ---- staging & commit ---------------------------------------------------
    stage: async (files) => {
      const a = active()
      if (!a) return
      await attempt(() => a.git.stage(files))
      await loadStatus(a.tabId)
    },
    unstage: async (files) => {
      const a = active()
      if (!a) return
      await attempt(() => a.git.unstage(files))
      await loadStatus(a.tabId)
    },
    stageAll: async () => {
      const a = active()
      if (!a) return
      await attempt(a.git.stageAll)
      await loadStatus(a.tabId)
    },
    unstageAll: async () => {
      const a = active()
      if (!a) return
      await attempt(a.git.unstageAll)
      await loadStatus(a.tabId)
    },
    commit: async (summary, description, newBranch) => {
      const a = active()
      if (!a) return false
      const hash = await withBusy('Committing…', () => a.git.commit(summary, description, newBranch))
      if (!hash) return false
      toast.success(
        newBranch ? `Committed ${hash.slice(0, 7)} to new branch '${newBranch.trim()}'` : `Committed ${hash.slice(0, 7)}`,
      )
      if (sessionOf(a.tabId)?.openDiff?.kind === 'working') patch(a.tabId, { openDiff: null })
      await loadAll(a.tabId)
      return true
    },

    // ---- branches -----------------------------------------------------------
    checkout: async (name, remote) => {
      const a = active()
      if (!a) return
      const r = await withBusy(`Switching to ${name}…`, () => a.git.checkout(name, remote))
      if (r) {
        const plural = (n: number) => `${n} commit${n === 1 ? '' : 's'}`
        if (r.fastForwarded) {
          toast.success(`Switched to branch '${r.branch}' and fast-forwarded ${plural(r.fastForwarded)} to ${r.upstream}`)
        } else {
          toast.success(`Switched to branch '${r.branch}'`)
        }
        if (r.fastForwardError) {
          toast.error(`'${r.branch}' is ${plural(r.behind ?? 0)} behind ${r.upstream} but could not be fast-forwarded:\n${r.fastForwardError}`)
        } else if (r.upstream && r.behind && r.ahead) {
          toast.info(`'${r.branch}' has diverged from ${r.upstream} (${r.ahead} ahead, ${r.behind} behind) — left as is`)
        } else if (r.upstream && r.behind) {
          toast.info(`'${r.branch}' is ${plural(r.behind)} behind ${r.upstream}`)
        }
      }
      await loadAll(a.tabId)
    },
    createBranch: async (name, checkout) => {
      const a = active()
      if (!a) return false
      const ok = await attempt(() => a.git.createBranch(name, checkout).then(() => true))
      if (ok) toast.success(`Created branch ${name}`)
      await loadAll(a.tabId)
      return !!ok
    },
    deleteBranch: async (name, force) => {
      const a = active()
      if (!a) return false
      const ok = await attempt(() => a.git.deleteBranch(name, force).then(() => true))
      if (ok) toast.success(`Deleted branch ${name}`)
      await loadAll(a.tabId)
      return !!ok
    },

    // ---- remote -------------------------------------------------------------
    addRemote: async (name, url) => {
      const a = active()
      if (!a) return false
      const ok = await attempt(() => a.git.addRemote(name, url).then(() => true))
      if (ok) {
        toast.success(`Added remote ${name.trim()}`)
        // Show it right away; the reload below then replaces this with git's own list
        const cur = sessionOf(a.tabId)?.branches
        if (cur && !cur.remotes?.some((r) => r.name === name.trim())) {
          patch(a.tabId, { branches: { ...cur, remotes: [...(cur.remotes ?? []), { name: name.trim(), url: url.trim() }] } })
        }
      }
      await loadBranches(a.tabId)
      return !!ok
    },
    fetchAll: async () => {
      const a = active()
      if (!a) return
      const ok = await withBusy('Fetching…', () => a.git.fetchAll().then(() => true))
      if (ok) toast.success('Fetched all remotes')
      await loadAll(a.tabId)
    },
    pull: async (mode = 'ff') => {
      const a = active()
      if (!a) return
      const r = await withBusy('Pulling…', () => a.git.pull(mode))
      if (r) {
        toast.success(
          r.commits
            ? `Pulled ${r.commits} commit${r.commits === 1 ? '' : 's'} into '${r.branch}'`
            : `'${r.branch}' is already up to date`,
        )
      }
      await loadAll(a.tabId)
    },
    push: async () => {
      const a = active()
      if (!a) return
      const r = await withBusy('Pushing…', () => a.git.push())
      if (r) {
        toast.success(
          r.setUpstream
            ? `Pushed '${r.branch}' to ${r.remote} (now tracking ${r.remote}/${r.branch})`
            : `Pushed '${r.branch}' to ${r.remote}`,
        )
      }
      await loadAll(a.tabId)
    },

    // ---- undo / redo --------------------------------------------------------
    undo: async () => {
      const a = active()
      if (!a) return
      const what = await withBusy('Undoing…', () => a.git.undo())
      if (what) toast.success(`Undid ${what}`)
      await loadAll(a.tabId)
    },
    redo: async () => {
      const a = active()
      if (!a) return
      const what = await withBusy('Redoing…', () => a.git.redo())
      if (what) toast.success(`Redid ${what}`)
      await loadAll(a.tabId)
    },
  }
})

// Save whenever tabs are opened, closed, reordered or switched
useRepoStore.subscribe((s, prev) => {
  if (s.tabs !== prev.tabs || s.activeTabId !== prev.activeTabId) saveTabs()
})

/** Git client for the active tab's repository (for components that fetch data directly) */
export function useActiveGit() {
  const path = useRepoStore((s) => s.repo?.path)
  return useMemo(() => (path ? gitFor(path) : null), [path])
}
