import { create } from 'zustand'

/** App-wide UI state that doesn't belong to a tab */
interface UiState {
  /** The Preferences page is shown instead of the tab content */
  settingsOpen: boolean
  openSettings: () => void
  closeSettings: () => void
}

export const useUiStore = create<UiState>((set) => ({
  settingsOpen: false,
  openSettings: () => set({ settingsOpen: true }),
  closeSettings: () => set({ settingsOpen: false }),
}))
