import type { CommitFile } from '../../types/git'

/** "+12 −3" for a file; nothing when there are no line counts (binary files) */
export function LineStats({ file }: { file: CommitFile }) {
  if (!file.additions && !file.deletions) return null
  return (
    <span className="shrink-0 font-mono text-[10.5px]">
      {!!file.additions && <span className="text-ok">+{file.additions}</span>}
      {!!file.additions && !!file.deletions && ' '}
      {!!file.deletions && <span className="text-danger">−{file.deletions}</span>}
    </span>
  )
}
