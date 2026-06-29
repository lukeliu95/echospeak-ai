import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import electron from 'vite-plugin-electron';
import renderer from 'vite-plugin-electron-renderer';

// Electron + Vite + React. Main process bundles to dist-electron/, renderer is served by Vite.
export default defineConfig({
  plugins: [
    react(),
    electron([
      {
        // Main process — holds the Gemini key, owns the Live session.
        entry: 'electron/main.ts',
        vite: {
          build: {
            outDir: 'dist-electron',
            rollupOptions: {
              // Keep @google/genai external so it loads from node_modules at runtime.
              external: ['@google/genai'],
            },
          },
        },
      },
      {
        // Preload — the only bridge between renderer and main.
        entry: 'electron/preload.ts',
        onstart(args) {
          args.reload();
        },
        vite: {
          build: { outDir: 'dist-electron' },
        },
      },
    ]),
    renderer(),
  ],
});
