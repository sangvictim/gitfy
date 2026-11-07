import type { GitfyApi } from '../../electron/preload'

declare global {
  interface Window {
    gitfy: GitfyApi
  }
}

export {}
