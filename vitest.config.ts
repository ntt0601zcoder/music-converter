import { defineConfig } from 'vitest/config';

// Dedicated test config so vitest does NOT load vite.config.ts (whose Cloudflare
// plugin registers a Worker environment incompatible with vitest). Our tests are
// plain TS (lib functions + Verovio), so they need no plugins.
export default defineConfig({
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts'],
  },
});
