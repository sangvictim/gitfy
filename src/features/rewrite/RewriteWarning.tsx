import { useEffect, useState } from 'react'
import { Icon } from '../../components/Icon'
import { useActiveGit } from '../../store/repo.store'
import type { RewriteInfo } from '../../types/git'

/** Load what rewriting history back to `base` would affect */
export function useRewriteInfo(base: string | null) {
  const git = useActiveGit()
  const [info, setInfo] = useState<RewriteInfo | null>(null)
  useEffect(() => {
    if (!git || !base) return
    let cancelled = false
    git
      .rewriteInfo(base)
      .then((i) => !cancelled && setInfo(i))
      .catch(() => !cancelled && setInfo(null))
    return () => {
      cancelled = true
    }
  }, [git, base])
  return info
}

/** Warn when commits that are already on the remote would be rewritten */
export function PushedWarning({ info, verb }: { info: RewriteInfo | null; verb: string }) {
  if (!info?.pushed) return null
  return (
    <p className="flex items-start gap-1.5 rounded-md bg-warn/10 px-2.5 py-2 text-xs text-warn">
      <Icon name="alert" size={13} className="mt-0.5 shrink-0" />
      <span>
        {info.pushed === info.commits
          ? info.pushed === 1
            ? 'This commit is'
            : `All ${info.pushed} commits are`
          : `${info.pushed} of these ${info.commits} commits ${info.pushed === 1 ? 'is' : 'are'}`}{' '}
        already on {info.upstream}. After you {verb},
        a normal push will be rejected and the branch would need a force push — avoid this on branches other people
        use.
      </span>
    </p>
  )
}
