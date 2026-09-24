import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.test.tsx'],
    environment: 'node',
    testTimeout: 15000,
    // The tests replay a real terminal: keep Ink out of its CI renderer (is-in-ci) on CI machines.
    env: { CI: 'false' },
  },
});
