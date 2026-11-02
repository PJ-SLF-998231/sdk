import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    setupFiles: ['test/setup.ts'],
    // The suite runs on shared, loaded CI runners; a lazily loaded chunk or an IndexedDB round trip can be slow there.
    testTimeout: 30_000,
    hookTimeout: 30_000,
  },
});
