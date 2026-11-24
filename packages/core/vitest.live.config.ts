import { fileURLToPath } from 'node:url';
import { loadEnv } from 'vite';
import { defineConfig } from 'vitest/config';

// apps/web/.env holds the project URL and publishable key; apps/web/.env.local holds SMOKE_EMAIL, SMOKE_PASSWORD, SMOKE_EDGE.
const webDir = fileURLToPath(new URL('../../apps/web/', import.meta.url));

export default defineConfig({
  test: {
    include: ['src/**/*.live.test.ts'],
    env: loadEnv('development', webDir, ''),
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
