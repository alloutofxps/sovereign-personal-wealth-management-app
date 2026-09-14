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
      // 'prompt' with an actual prompt behind it. The Phase 2 audit found this
      // set to prompt with nothing listening, which strands people on a stale
      // build forever; autoUpdate fixed that but reloads without asking, which
      // is unkind mid-entry. src/app/pwa/useAppUpdate.ts is the missing half.
      registerType: 'prompt',
      // Phase 5 replaces this with a hand-written service worker that also
      // guards storage persistence. For now: precache the shell so the app
      // opens offline, which is the whole point of a local-first ledger.
      workbox: {
        // The WASM binary matters most: without it the app opens offline and
        // then cannot reach its own database. Fonts are here for the same
        // reason — a local-first ledger must not need the network to render.
        globPatterns: ['**/*.{js,css,html,wasm,woff2,woff,png,svg,webmanifest}'],
        // The plugin puts the web manifest and the icons it names into the
        // precache list itself. Letting the glob find them as well is how the
        // same file ends up in there twice, so the glob stands aside for the
        // four the plugin already owns. The favicon and the Apple touch icon
        // are not among them, and stay matched here.
        globIgnores: [
          'manifest.webmanifest',
          'icons/icon-*.png',
          'icons/maskable-*.png',
          'icons/monochrome-*.png',
        ],
        // The SQLite binary is roughly 900 KB and the default ceiling is two,
        // so raise it explicitly rather than discovering the miss in the wild.
        maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
        navigateFallback: 'index.html',
        cleanupOutdatedCaches: true,
      },
      // `includeAssets` is deliberately not set. The glob above already
      // matches every .svg and .png in dist/, and listing them again put six
      // files into the precache manifest twice. Identical revisions make that
      // harmless right up until it is not: Workbox rejects two entries for one
      // URL whose revisions disagree, and it rejects them by failing the whole
      // service worker install — no offline, and no way to ship an update.
      manifest: {
        id: '/',
        name: 'Sovereign',
        short_name: 'Sovereign',
        description: 'Autonomous precision, sovereign wealth.',
        start_url: '/',
        scope: '/',
        display: 'standalone',
        orientation: 'portrait',
        // Daylight is the default theme, so these are Daylight's ground --
        // the same value `index.html` gives `theme-color` before the pre-paint
        // script has anything to switch. They were `#08090A`, which is the
        // pre-redesign ground and is in neither theme.
        background_color: '#edf0ea',
        theme_color: '#edf0ea',
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
          {
            src: 'icons/monochrome-512.png',
            sizes: '512x512',
            type: 'image/png',
            purpose: 'monochrome',
          },
        ],
        /* Both of these pointed at query strings and nothing in the app has
         * ever read one, so both opened the dashboard. `action=add` is
         * honoured now — see `wantsToRecord` in `AppShell` — because the
         * record sheet is a boolean the shell already owns. The other is a
         * route, so it goes through the router the way every other link in
         * the app does. */
        shortcuts: [
          { name: 'Record a payment', url: '/?action=add' },
          { name: 'Things to review', url: '/#/triage' },
        ],
      },
      devOptions: { enabled: false },
    }),
  ],
  build: {
    target: 'es2022',
    sourcemap: true,
    rollupOptions: {
      output: {
        advancedChunks: {
          groups: [
            {
              /**
               * The application plumbing the home screen already needs.
               *
               * Left to itself the bundler extracts a separate chunk for every
               * one of these the moment a second lazy screen imports it, which
               * is how adding one route turned five modules that were already
               * inside the entry into five extra preloaded files. Same bytes,
               * five more round trips, and gzip working on five small windows
               * instead of one large one.
               *
               * Only modules the first paint loads anyway may be listed here —
               * anything lazy-only would be dragged forward.
               */
              name: 'app-core',
              test: /[\\/]src[\\/]app[\\/](dates|toast|ledger[\\/](actions|useLedger)|taxonomy[\\/]useTaxonomy)\.tsx?$/,
            },
          ],
        },
      },
    },
  },
});
