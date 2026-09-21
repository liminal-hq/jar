import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

// Standard Tauri + Vite dev-server setup: a fixed port the Rust shell's
// `devUrl` (see `src-tauri/tauri.conf.json`) points at, and `strictPort`
// so a stale process never silently shifts the port out from under it.
//
// `JAR_LAN_DEV=1` (see the `dev:lan` script) additionally binds to
// `0.0.0.0` instead of the default localhost-only, so a Tauri binary
// running on another machine on the LAN — e.g. a Windows build pointed at
// this host via `tauri.conf.remote.json` (see that file's `.example`) —
// can reach this dev server for live HMR while the Rust backend runs
// natively on that machine. Off by default: plain `bun run dev` never
// exposes the dev server beyond localhost.
export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: process.env.JAR_LAN_DEV ? true : 'localhost',
  },
  build: {
    target: 'esnext',
    minify: 'esbuild',
    sourcemap: true,
  },
});
