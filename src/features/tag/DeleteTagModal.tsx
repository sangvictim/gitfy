import { useState } from 'react'
import { ConfirmModal } from '../../components/ConfirmModal'
import { useRepoStore } from '../../store/repo.store'

export function DeleteTagModal({ name, onClose }: { name: string; onClose: () => void }) {
  const deleteTag = useRepoStore((s) => s.deleteTag)
  const hasRemote = useRepoStore((s) => (s.branches?.remotes.length ?? 0) > 0)
  const [remote, setRemote] = useState(false)
  return (
    <ConfirmModal title="Delete tag" confirmLabel="Delete" danger onConfirm={() => deleteTag(name, remote)} onClose={onClose}>
      <p>
        Delete tag <span className="font-mono font-semibold">{name}</span>? The commit itself is not affected.
      </p>
      {hasRemote && (
        <label className="flex items-start gap-2 text-[13px]">
          <input type="checkbox" className="mt-0.5 accent-accent" checked={remote} onChange={(e) => setRemote(e.target.checked)} />
          <span>
            Also delete it from the remote
            <span className="block text-xs text-muted">
              {remote ? "Other people who already fetched it keep their copy. This can't be undone from Gitfy." : 'Otherwise only your local tag is removed (Undo brings it back).'}
            </span>
          </span>
        </label>
      )}
    </ConfirmModal>
  )
}
