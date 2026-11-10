import type { ConflictResolution, IpcResult, OpenTabs, PullMode, ResetMode } from '../types/git'

/** Unwrap an IpcResult, turning `{ ok: false }` into a thrown Error for ergonomic try/catch in the UI */
async function unwrap<T>(p: Promise<IpcResult<T>>): Promise<T> {
  const res = await p
  if (!res.ok) throw new Error(res.error)
  return res.data
}

const api = () => window.gitfy

/** Calls that don't belong to a repository */
export const ipc = {
  selectDirectory: (title?: string) => unwrap(api().dialog.selectDirectory(title)),

  openRepo: (dir: string, remember?: boolean) => unwrap(api().repo.open(dir, remember)),
  initRepo: (dir: string) => unwrap(api().repo.init(dir)),
  cloneRepo: (url: string, parent: string, name?: string) => unwrap(api().repo.clone(url, parent, name)),
  closeRepo: (repo: string) => unwrap(api().repo.close(repo)),
  recentRepos: () => unwrap(api().repo.recent()),
  removeRecent: (path: string) => unwrap(api().repo.removeRecent(path)),
  revealRepo: (repo: string) => unwrap(api().repo.reveal(repo)),

  getOpenTabs: () => unwrap(api().tabs.get()),
  saveOpenTabs: (tabs: OpenTabs) => unwrap(api().tabs.save(tabs)),

  getSettings: () => unwrap(api().settings.get()),
  sshKeyInfo: () => unwrap(api().settings.sshKeyInfo()),
  setSshAgent: (useAgent: boolean) => unwrap(api().settings.setSshAgent(useAgent)),
  browseSshKey: (kind: 'private' | 'public') => unwrap(api().settings.browseSshKey(kind)),
  generateSshKey: () => unwrap(api().settings.generateSshKey()),
  readSshPublicKey: () => unwrap(api().settings.readSshPublicKey()),
  testSsh: (host?: string) => unwrap(api().settings.testSsh(host)),

  appVersion: () => unwrap(api().app.version()),
}

/** Git calls bound to one repository (one tab) */
export function gitFor(repo: string) {
  const g = () => api().git
  return {
    status: () => unwrap(g().status(repo)),
    stage: (files: string[]) => unwrap(g().stage(repo, files)),
    stageAll: () => unwrap(g().stageAll(repo)),
    unstage: (files: string[]) => unwrap(g().unstage(repo, files)),
    unstageAll: () => unwrap(g().unstageAll(repo)),
    fileDiff: (file: string, staged: boolean, from?: string) => unwrap(g().fileDiff(repo, file, staged, from)),

    commit: (summary: string, description?: string, newBranch?: string) =>
      unwrap(g().commit(repo, summary, description, newBranch)),
    log: (limit?: number) => unwrap(g().log(repo, limit)),
    getCommit: (hash: string) => unwrap(g().getCommit(repo, hash)),
    commitFiles: (hash: string) => unwrap(g().commitFiles(repo, hash)),
    commitFileDiff: (hash: string, file: string, from?: string) => unwrap(g().commitFileDiff(repo, hash, file, from)),

    branches: () => unwrap(g().branches(repo)),
    checkout: (name: string, remote?: boolean) => unwrap(g().checkout(repo, name, remote)),
    createBranch: (name: string, checkout?: boolean) => unwrap(g().createBranch(repo, name, checkout)),
    deleteBranch: (name: string, force?: boolean) => unwrap(g().deleteBranch(repo, name, force)),

    addRemote: (name: string, url: string) => unwrap(g().addRemote(repo, name, url)),
    updateRemote: (oldName: string, name: string, url: string) => unwrap(g().updateRemote(repo, oldName, name, url)),
    fetchAll: () => unwrap(g().fetchAll(repo)),
    pull: (mode?: PullMode) => unwrap(g().pull(repo, mode)),
    push: () => unwrap(g().push(repo)),

    merge: (from: string, noFastForward?: boolean) => unwrap(g().merge(repo, from, noFastForward)),
    conflict: (file: string) => unwrap(g().conflict(repo, file)),
    resolveConflict: (file: string, resolution: ConflictResolution) =>
      unwrap(g().resolveConflict(repo, file, resolution)),
    continueOperation: (message?: string) => unwrap(g().continueOperation(repo, message)),
    abortOperation: () => unwrap(g().abortOperation(repo)),

    rewriteInfo: (base: string) => unwrap(g().rewriteInfo(repo, base)),
    commitRelation: (hash: string) => unwrap(g().commitRelation(repo, hash)),
    rebase: (onto: string) => unwrap(g().rebase(repo, onto)),
    cherryPick: (hash: string) => unwrap(g().cherryPick(repo, hash)),
    revert: (hash: string) => unwrap(g().revert(repo, hash)),
    reset: (hash: string, mode: ResetMode) => unwrap(g().reset(repo, hash, mode)),
    headMessage: () => unwrap(g().headMessage(repo)),
    amend: (summary: string, description?: string) => unwrap(g().amend(repo, summary, description)),
    stashPush: (message?: string, includeUntracked?: boolean) => unwrap(g().stashPush(repo, message, includeUntracked)),
    stashApply: (ref: string, pop?: boolean) => unwrap(g().stashApply(repo, ref, pop)),
    stashDrop: (ref: string) => unwrap(g().stashDrop(repo, ref)),
    createTag: (name: string, target?: string, message?: string) => unwrap(g().createTag(repo, name, target, message)),
    deleteTag: (name: string, fromRemote?: boolean) => unwrap(g().deleteTag(repo, name, fromRemote)),
    pushTags: (name?: string) => unwrap(g().pushTags(repo, name)),
    discard: (files: string[]) => unwrap(g().discard(repo, files)),

    history: () => unwrap(g().history(repo)),
    undo: () => unwrap(g().undo(repo)),
    redo: () => unwrap(g().redo(repo)),
  }
}
