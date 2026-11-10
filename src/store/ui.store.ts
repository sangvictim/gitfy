import { create } from 'zustand'

/** Pages of the Preferences screen: global ones, then ones for the active tab's repository */
export type SettingsSection = 'ssh' | 'identity' | 'gitignore' | 'lfs'

/** App-wide UI state that doesn't belong to a tab */
interface UiState {
  /** The Preferences page is shown instead of the tab content */
  settingsOpen: boolean
  settingsSection: SettingsSection
  openSettings: (section?: SettingsSection) => void
  setSettingsSection: (section: SettingsSection) => void
  closeSettings: () => void
}

export const useUiStore = create<UiState>((set) => ({
  settingsOpen: false,
  settingsSection: 'ssh',
  openSettings: (section) => set((s) => ({ settingsOpen: true, settingsSection: section ?? s.settingsSection })),
  setSettingsSection: (settingsSection) => set({ settingsSection }),
  closeSettings: () => set({ settingsOpen: false }),
}))
