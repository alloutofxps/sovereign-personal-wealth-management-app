import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { fileURLToPath, URL } from 'node:url';

/**
 * Cross-origin isolation.
 *
 * These two headers put the page in a cross-origin isolated context, which is
 * the precondition for SharedArrayBuffer — and therefore for SQLite's classic
 * OPFS VFS, should Phase 4 need to fall back to it from `opfs-sahpool`.
 *
 * They cost us nothing today because the app loads no cross-origin
 * subresources: fonts are bundled, there is no CDN, and there are no remote
 * images. Setting them now means `crossOriginIsolated === true` is verifiable
 * from the start and losing it later shows up as a regression rather than as a
 * surprise during the storage build.
 *
 * Production hosting must send the same two headers — Vite only controls dev
 * and preview.
 */
const CROSS_ORIGIN_ISOLATION = {
  'Cross-Origin-Opener-Policy': 'same-origin',
  'Cross-Origin-Embedder-Policy': 'require-corp',
};

export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  server: { headers: CROSS_ORIGIN_ISOLATION },
  // The SQLite WASM binary must not be pre-bundled — esbuild rewrites the
  // module in a way that breaks its worker and OPFS entry points.
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  preview: { headers: CROSS_ORIGIN_ISOLATION },
  plugins: [
    react(),
    tailwindcss(),
    VitePWA({
      // A waiting service worker that never activates strands users on a stale
      // build across deploys. For a ledger that will ship correctness fixes,
      // applying the update on next load is the safer default. Phase 5 can
      // reintroduce an explicit prompt once there is UI to host it.
      registerType: 'autoUpdate',
      // Phase 5 replaces this with a hand-written service worker that also
      // guards storage persistence. For now: precache the shell so the app
      // opens offline, which is the whole point of a local-first ledger.
      workbox: {
        globPatterns: ['**/*.{js,css,html,woff2,png,svg}'],
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      includeAssets: ['favicon.svg', 'icons/apple-touch-icon.png'],
      manifest: {
        id: '/',
        name: 'Sovereign',
        short_name: 'Sovereign',
        description: 'Autonomous precision, sovereign wealth.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        background_color: '#08090A',
        theme_color: '#08090A',
        categories: ['finance', 'productivity'],
        icons: [
          { src: 'icons/icon-192.png', sizes: '192x192', type: 'image/png' },
          { src: 'icons/icon-512.png', sizes: '512x512', type: 'image/png' },
          {
            src: 'icons/maskable-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'maskable',
          },
        ],
        shortcuts: [
          { name: 'Add transaction', url: '/?action=add' },
          { name: 'Triage queue', url: '/?view=triage' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
  },
});
