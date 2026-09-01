import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

// https://vite.dev/config/
// Config aligned with Tauri's expectations (devUrl/frontendDist in src-tauri/tauri.conf.json).
const host = process.env.TAURI_DEV_HOST

export default defineConfig({
  plugins: [react()],
  clearScreen: false,
  server: {
    port: 1420,
    strictPort: true,
    host: host || false,
    hmr: host
      ? {
          protocol: 'ws',
          host,
          port: 1421,
        }
      : undefined,
    watch: {
      ignored: ['**/src-tauri/**'],
    },
  },
  envPrefix: ['VITE_', 'TAURI_'],
  build: {
    // Rely on Vite's default modern-browser target — Tauri's webviews (WebKit2GTK,
    // WKWebView, WebView2) are all evergreen enough that we don't need legacy targets,
    // and pinning one (e.g. "safari13") trips a destructuring-transform bug in the
    // current esbuild/rolldown-vite combo.
    sourcemap: !!process.env.TAURI_ENV_DEBUG,
  },
})
