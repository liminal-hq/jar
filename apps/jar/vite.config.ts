import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Standard Tauri + Vite dev-server setup: a fixed port the Rust shell's
// `devUrl` (see `src-tauri/tauri.conf.json`) points at, and `strictPort`
// so a stale process never silently shifts the port out from under it.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: true,
  },
});
