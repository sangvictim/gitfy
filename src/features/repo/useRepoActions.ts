import { ipc } from '../../services/ipc'
import { useRepoStore } from '../../store/repo.store'
import { toast } from '../../store/toast.store'

/** Dialog-driven repository actions shared by the welcome screen and header */
export function useRepoActions() {
  const openRepo = useRepoStore((s) => s.openRepo)
  const initRepo = useRepoStore((s) => s.initRepo)

  const pick = async (title: string) => {
    try {
      return await ipc.selectDirectory(title)
    } catch (err) {
      toast.error(err instanceof Error ? err.message : String(err))
      return null
    }
  }

  return {
    openWithDialog: async () => {
      const dir = await pick('Open Git repository')
      if (dir) await openRepo(dir)
    },
    initWithDialog: async () => {
      const dir = await pick('Choose a folder for the new repository')
      if (dir) await initRepo(dir)
    },
    pick,
  }
}
