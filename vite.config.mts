import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'

// Editors like VS Code set this for their own child processes; it makes Electron behave like plain Node.
delete process.env.ELECTRON_RUN_AS_NODE

export default defineConfig({
  // Monaco is several MB; chunk size doesn't matter for a desktop app loading from disk
  build: { chunkSizeWarningLimit: 6000 },
  plugins: [
    react(),
    tailwindcss(),
    electron({
      main: {
        entry: 'electron/main.ts',
      },
      preload: {
        input: 'electron/preload.ts',
      },
    }),
  ],
})
