import type { ConflictKind, RepoStatus } from '../../types/git'

/**
 * Human names for the two sides of a conflict. "Current" is what you had checked out,
 * "Incoming" is what is being brought in. During a rebase git swaps them: "ours" is the
 * branch being rebased onto, "theirs" is your own commit being replayed.
 */
export function sideNames(status: RepoStatus | null): { ours: string; theirs: string } {
  const op = status?.operation
  const branch = status?.branch ?? 'HEAD'
  // Conflicts without an operation come from applying a stash
  if (!op) return { ours: branch, theirs: 'stash' }
  switch (op.kind) {
    case 'merge':
      return { ours: branch, theirs: op.incoming ?? 'incoming' }
    case 'cherry-pick':
    case 'revert':
      return { ours: branch, theirs: op.incoming?.split(' ')[0] ?? op.kind }
    case 'rebase':
      return { ours: op.incoming?.split(' ')[0] ?? 'upstream', theirs: 'your commit' }
  }
}

export function describeConflict(kind: ConflictKind, ours: string, theirs: string): string {
  switch (kind) {
    case 'both-modified':
      return 'Changed on both sides'
    case 'both-added':
      return 'Added on both sides'
    case 'both-deleted':
      return 'Deleted on both sides'
    case 'deleted-by-us':
      return `Deleted on ${ours}, changed on ${theirs}`
    case 'deleted-by-them':
      return `Changed on ${ours}, deleted on ${theirs}`
    case 'added-by-us':
      return `Only added on ${ours}`
    case 'added-by-them':
      return `Only added on ${theirs}`
  }
}

/** Whether git left a file with conflict markers to pick from (vs. a keep-or-delete decision) */
export function isTextConflict(kind: ConflictKind): boolean {
  return kind === 'both-modified' || kind === 'both-added'
}
