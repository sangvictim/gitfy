import { useEffect, useRef, useState } from 'react'
import { ContextMenu, type MenuEntry } from '../../components/ContextMenu'
import { useActiveGit, useRepoStore } from '../../store/repo.store'
import { toast } from '../../store/toast.store'
import type { Commit, CommitRelation, ResetMode } from '../../types/git'
import { CreateBranchModal } from '../branch/CreateBranchModal'
import { DeleteBranchModal } from '../branch/DeleteBranchModal'
import { MergeModal } from '../branch/MergeModal'
import { AmendModal } from '../rewrite/AmendModal'
import { PickRevertModal } from '../rewrite/PickRevertModal'
import { RebaseModal } from '../rewrite/RebaseModal'
import { ResetModal } from '../rewrite/ResetModal'
import { StashModal } from '../stash/StashModal'
import { CreateTagModal } from '../tag/CreateTagModal'
import { DeleteTagModal } from '../tag/DeleteTagModal'

type Dialog =
  | { kind: 'merge'; from: string }
  | { kind: 'rebase'; onto: string }
  | { kind: 'cherry-pick' | 'revert' | 'amend' | 'branch' | 'tag' | 'stash' }
  | { kind: 'reset'; mode: ResetMode }
  | { kind: 'deleteBranch'; name: string }
  | { kind: 'deleteTag'; name: string }

export interface ContextTarget {
  commit: Commit
  isWip: boolean
  x: number
  y: number
}

/**
 * Right-click menu of a graph row. Only offers what Gitfy can already do, phrased for this commit and
 * the checked-out branch; each entry opens the same dialog as its button elsewhere.
 */
export function CommitContextMenu({ target, onDone }: { target: ContextTarget; onDone: () => void }) {
  const git = useActiveGit()
  const status = useRepoStore((s) => s.status)
  const branches = useRepoStore((s) => s.branches)
  const busy = useRepoStore((s) => s.busy)
  const { pull, push, checkout, setOpenDiff, stageAll, unstageAll } = useRepoStore()
  const [rel, setRel] = useState<CommitRelation | null>(null)
  const [menuOpen, setMenuOpen] = useState(true)
  const [dialog, setDialog] = useState<Dialog | null>(null)
  const { commit, isWip } = target

  useEffect(() => {
    if (!git || isWip) return
    let cancelled = false
    git
      .commitRelation(commit.hash)
      .then((r) => !cancelled && setRel(r))
      .catch(() => !cancelled && setRel({ isHead: false, inHead: false }))
    return () => {
      cancelled = true
    }
  }, [git, commit.hash, isWip])

  // A ref, not state: the menu's close handler runs in the same tick as the click that opened a dialog
  const dialogOpen = useRef(false)
  const closeMenu = () => {
    setMenuOpen(false)
    if (!dialogOpen.current) onDone()
  }
  const open = (d: Dialog) => {
    dialogOpen.current = true
    setDialog(d)
    setMenuOpen(false)
  }
  const closeDialog = () => {
    dialogOpen.current = false
    setDialog(null)
    onDone()
  }

  const current = status?.branch ?? null
  const busyOrOp = !!busy || !!status?.operation
  const locals = commit.refs.filter((r) => r.type === 'local').map((r) => r.name)
  const remotes = commit.refs.filter((r) => r.type === 'remote').map((r) => r.name)
  const tags = commit.refs.filter((r) => r.type === 'tag').map((r) => r.name)
  const otherLocals = locals.filter((n) => n !== current)
  // What to merge / rebase onto: the branch on this commit if there is one, otherwise the commit itself
  const ref = otherLocals[0] ?? remotes[0] ?? commit.shortHash
  const upstreamRemote = status?.tracking?.split('/')[0] ?? null
  const otherRemotes = (branches?.remotes ?? []).filter((r) => r.name !== upstreamRemote)

  const copy = (text: string, what: string) =>
    navigator.clipboard.writeText(text).then(() => toast.info(`Copied ${what}`))

  const items: MenuEntry[] = []
  const group = (...entries: (MenuEntry | false | null | undefined)[]) => {
    const list = entries.filter(Boolean) as MenuEntry[]
    if (!list.length) return
    if (items.length) items.push('separator')
    items.push(...list)
  }

  if (isWip) {
    const changes = (status?.staged.length ?? 0) + (status?.unstaged.length ?? 0)
    group(
      { label: 'Stash changes…', disabled: busyOrOp || !changes, onClick: () => open({ kind: 'stash' }) },
      { label: 'Stage all changes', disabled: !status?.unstaged.length, onClick: () => stageAll() },
      { label: 'Unstage all changes', disabled: !status?.staged.length, onClick: () => unstageAll() },
    )
  } else if (rel) {
    const isHead = rel.isHead && !!current
    // Remote actions on the checked-out branch's tip
    group(
      isHead && { label: 'Pull (fast-forward if possible)', disabled: !!busy, onClick: () => pull('ff') },
      isHead && { label: 'Push', disabled: !!busy, onClick: () => push() },
      isHead &&
        otherRemotes.length > 0 && {
          label: status?.tracking ? 'Push to another remote' : 'Set upstream',
          disabled: !!busy,
          children: otherRemotes.map((r) => ({
            label: `${r.name}/${current}`,
            hint: `Push ${current} to ${r.name} and track it`,
            onClick: () => push({ remote: r.name }),
          })),
        },
    )
    // Bringing this commit / branch together with the current branch
    group(
      !!current &&
        !rel.inHead && { label: `Merge ${ref} into ${current}…`, disabled: busyOrOp, onClick: () => open({ kind: 'merge', from: ref }) },
      !!current &&
        !rel.inHead && { label: `Rebase ${current} onto ${ref}…`, disabled: busyOrOp, onClick: () => open({ kind: 'rebase', onto: ref }) },
    )
    // Switching to a branch on this commit
    const checkoutable = [...otherLocals.map((n) => ({ n, remote: false })), ...remotes.map((n) => ({ n, remote: true }))]
    group(
      checkoutable.length > 0 && {
        label: 'Checkout',
        disabled: !!busy,
        children: checkoutable.map(({ n, remote }) => ({ label: n, onClick: () => checkout(n, remote) })),
      },
    )
    // Changing history
    group(
      isHead && { label: 'Create branch here…', disabled: !!busy, onClick: () => open({ kind: 'branch' }) },
      !rel.inHead && { label: 'Cherry pick commit…', disabled: busyOrOp, onClick: () => open({ kind: 'cherry-pick' }) },
      !!current &&
        !isHead && {
          label: `Reset ${current} to this commit`,
          disabled: busyOrOp,
          children: (
            [
              ['soft', 'Soft — keep all changes, staged'],
              ['mixed', 'Mixed — keep all changes, unstaged'],
              ['hard', 'Hard — discard all changes'],
            ] as const
          ).map(([mode, label]) => ({
            label,
            danger: mode === 'hard',
            onClick: () => open({ kind: 'reset', mode }),
          })),
        },
      rel.inHead && { label: 'Revert commit…', disabled: busyOrOp, onClick: () => open({ kind: 'revert' }) },
      isHead && { label: 'Amend commit…', disabled: busyOrOp, onClick: () => open({ kind: 'amend' }) },
    )
    // Branches on this commit
    group(
      ...otherLocals.map((n) => ({
        label: `Compare ${n} with ${current ?? 'HEAD'}`,
        onClick: () => setOpenDiff({ kind: 'compare', base: current ?? 'HEAD', head: n }),
      })),
      ...otherLocals.map((n) => ({ label: `Delete ${n}…`, danger: true, onClick: () => open({ kind: 'deleteBranch', name: n }) })),
    )
    // Clipboard
    const names = [...locals, ...remotes]
    group(
      names.length === 1 && { label: 'Copy branch name', onClick: () => copy(names[0], `"${names[0]}"`) },
      names.length > 1 && {
        label: 'Copy branch name',
        children: names.map((n) => ({ label: n, onClick: () => copy(n, `"${n}"`) })),
      },
      { label: 'Copy commit sha', onClick: () => copy(commit.hash, `commit ${commit.shortHash}`) },
    )
    // Tags
    group(
      { label: 'Create tag here…', onClick: () => open({ kind: 'tag' }) },
      ...tags.map((t) => ({ label: `Delete tag ${t}…`, danger: true, onClick: () => open({ kind: 'deleteTag', name: t }) })),
    )
  }

  return (
    <>
      {menuOpen && (isWip || rel) && <ContextMenu x={target.x} y={target.y} items={items} onClose={closeMenu} />}
      {dialog?.kind === 'merge' && <MergeModal from={dialog.from} onClose={closeDialog} />}
      {dialog?.kind === 'rebase' && <RebaseModal onto={dialog.onto} onClose={closeDialog} />}
      {(dialog?.kind === 'cherry-pick' || dialog?.kind === 'revert') && (
        <PickRevertModal action={dialog.kind} commit={commit} onClose={closeDialog} />
      )}
      {dialog?.kind === 'reset' && <ResetModal commit={commit} initialMode={dialog.mode} onClose={closeDialog} />}
      {dialog?.kind === 'amend' && <AmendModal onClose={closeDialog} />}
      {dialog?.kind === 'branch' && <CreateBranchModal onClose={closeDialog} />}
      {dialog?.kind === 'tag' && <CreateTagModal target={commit.hash} onClose={closeDialog} />}
      {dialog?.kind === 'stash' && <StashModal onClose={closeDialog} />}
      {dialog?.kind === 'deleteBranch' && <DeleteBranchModal name={dialog.name} onClose={closeDialog} />}
      {dialog?.kind === 'deleteTag' && <DeleteTagModal name={dialog.name} onClose={closeDialog} />}
    </>
  )
}
