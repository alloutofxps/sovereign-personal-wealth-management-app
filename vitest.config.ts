import { defineConfig } from 'vitest/config';
import { fileURLToPath, URL } from 'node:url';

/* Kept separate from vite.config.ts on purpose: Vitest resolves its own copy
 * of Vite, and sharing one config file makes the two plugin type universes
 * collide under exactOptionalPropertyTypes. The test run needs no plugins —
 * the ledger core is plain TypeScript with no JSX and no browser. */
export default defineConfig({
  resolve: {
    alias: { '@': fileURLToPath(new URL('./src', import.meta.url)) },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx'],
  },
});
