import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import electron from 'vite-plugin-electron/simple'

// `npm run dev` launches Electron; `npm run dev:web` serves the UI in a browser only.
export default defineConfig(({ mode }) => ({
  // Relative asset paths so the built app loads from file:// inside Electron.
  base: './',
  plugins: [
    react(),
    tailwindcss(),
    mode !== 'web' &&
      electron({
        main: { entry: 'electron/main.ts' },
        preload: { input: 'electron/preload.ts' },
      }),
  ],
  server: { port: 5173, strictPort: true },
}))
