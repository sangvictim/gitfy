import type { HistoryState } from '../../src/types/git'

/**
 * Undoable operations performed through Gitfy. Each records exactly what is needed to reverse
 * it and to verify (before undoing / redoing) that the repository is still in the expected state.
 */
export type Op =
  | {
      kind: 'commit'
      /** Branch the commit was made on (null = detached HEAD) */
      branch: string | null
      hash: string
      /** HEAD before the commit (null = it was the first commit) */
      parent: string | null
      subject: string
    }
  | {
      kind: 'checkout'
      /** Branch name, or commit hash when HEAD was detached */
      from: string
      fromDetached: boolean
      to: string
      /** The local branch was created to track this remote branch */
      created?: { upstream: string }
      /** The local branch was fast-forwarded as part of the checkout */
      ff?: { before: string; after: string }
    }
  | {
      kind: 'createBranch'
      name: string
      hash: string
      checkedOut: boolean
      /** Where HEAD was before (branch name or hash) — to go back when undoing a create+switch */
      prev: string | null
      prevDetached: boolean
    }
  | { kind: 'deleteBranch'; name: string; hash: string }
  | { kind: 'pull'; branch: string; before: string; after: string }
  /**
   * The branch (or detached HEAD) was moved from `before` to `after` by a rebase, cherry-pick,
   * revert, reset or amend. Undo / redo move it back with `git reset --<mode>`.
   */
  | {
      kind: 'headMove'
      /** e.g. "cherry-pick of abc1234" */
      what: string
      branch: string | null
      before: string
      after: string
      /** keep = also update the working tree (refusing to overwrite local changes); soft / mixed = keep it */
      mode: 'keep' | 'soft' | 'mixed'
    }
  /** A dropped stash — its commit still exists, so it can be stored back */
  | { kind: 'dropStash'; hash: string; message: string }
  /** A deleted tag; `object` is the tag object (annotated) or commit (lightweight) it pointed to */
  | { kind: 'deleteTag'; name: string; object: string }
  /** A merge that finished (fast-forward, clean, or after resolving conflicts) */
  | { kind: 'merge'; branch: string; from: string; before: string; after: string }

const MAX_HISTORY = 50

export function describe(op: Op): string {
  switch (op.kind) {
    case 'commit':
      return `commit "${op.subject.length > 50 ? op.subject.slice(0, 50) + '…' : op.subject}"`
    case 'checkout':
      return `checkout of ${op.to}`
    case 'createBranch':
      return `create branch ${op.name}`
    case 'deleteBranch':
      return `delete branch ${op.name}`
    case 'pull':
      return `pull into ${op.branch}`
    case 'merge':
      return `merge of ${op.from} into ${op.branch}`
    case 'headMove':
      return op.what
    case 'dropStash':
      return `drop of stash "${op.message.length > 40 ? op.message.slice(0, 40) + '…' : op.message}"`
    case 'deleteTag':
      return `delete tag ${op.name}`
  }
}

/** The repository no longer matches what the operation left behind — it can't be safely reversed */
export class StaleOperationError extends Error {}

/** Undo / redo stacks per open repository (in memory, cleared when the tab is closed) */
class HistoryService {
  private stacks = new Map<string, { undo: Op[]; redo: Op[] }>()

  private of(repo: string) {
    let s = this.stacks.get(repo)
    if (!s) this.stacks.set(repo, (s = { undo: [], redo: [] }))
    return s
  }

  /** A new operation invalidates anything that could be redone */
  record(repo: string, op: Op) {
    const s = this.of(repo)
    s.undo.push(op)
    if (s.undo.length > MAX_HISTORY) s.undo.shift()
    s.redo = []
  }

  peekUndo(repo: string): Op | undefined {
    return this.of(repo).undo.at(-1)
  }
  peekRedo(repo: string): Op | undefined {
    return this.of(repo).redo.at(-1)
  }

  /** After a successful undo: move the operation to the redo stack */
  undone(repo: string) {
    const s = this.of(repo)
    const op = s.undo.pop()
    if (op) s.redo.push(op)
  }
  /** After a successful redo: move the operation back to the undo stack */
  redone(repo: string) {
    const s = this.of(repo)
    const op = s.redo.pop()
    if (op) s.undo.push(op)
  }

  dropUndo(repo: string) {
    this.of(repo).undo.pop()
  }
  dropRedo(repo: string) {
    this.of(repo).redo.pop()
  }

  clear(repo: string) {
    this.stacks.delete(repo)
  }

  state(repo: string): HistoryState {
    const u = this.peekUndo(repo)
    const r = this.peekRedo(repo)
    return { undo: u ? describe(u) : null, redo: r ? describe(r) : null }
  }
}

export const history = new HistoryService()
