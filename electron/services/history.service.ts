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
