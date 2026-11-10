import { useEffect, useState } from 'react'
import { DiffViewer } from '../../components/DiffViewer'
import { useActiveGit, useRepoStore, type DiffTarget } from '../../store/repo.store'
import type { DiffContent } from '../../types/git'

/** Full-width diff shown in place of the graph */
export function DiffPanel({ target }: { target: Exclude<DiffTarget, { kind: 'conflict' }> }) {
  const setOpenDiff = useRepoStore((s) => s.setOpenDiff)
  const git = useActiveGit()
  // Working-copy diffs refresh whenever the status is polled (the file may have been edited)
  const status = useRepoStore((s) => (target.kind === 'working' ? s.status : null))
  const [diff, setDiff] = useState<DiffContent | null>(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    if (!git) return
    let cancelled = false
    setLoading(true)
    const load =
      target.kind === 'working'
        ? git.fileDiff(target.path, target.staged, target.from)
        : git.commitFileDiff(target.hash, target.path, target.from)
    load
      .then((d) => {
        if (cancelled) return
        // Avoid resetting the editor if nothing changed
        setDiff((prev) =>
          prev && prev.path === d.path && prev.original === d.original && prev.modified === d.modified ? prev : d,
        )
      })
      .catch(() => !cancelled && setDiff(null))
      .finally(() => !cancelled && setLoading(false))
    return () => {
      cancelled = true
    }
  }, [target, status, git])

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpenDiff(null)
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [setOpenDiff])

  const label =
    target.kind === 'working' ? (target.staged ? 'staged' : 'unstaged') : `commit ${target.hash.slice(0, 7)}`

  return (
    <DiffViewer
      diff={diff && diff.path === target.path ? diff : null}
      loading={loading}
      onClose={() => setOpenDiff(null)}
      title={
        <>
          <span className="mr-2 rounded bg-panel-2 px-1.5 py-0.5 font-sans text-[10px] text-muted uppercase">{label}</span>
          {target.from ? `${target.from} → ` : ''}
          {target.path}
        </>
      }
    />
  )
}
