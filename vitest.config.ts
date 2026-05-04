import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['tests/**/*.test.ts'],
    globals: true,
    testTimeout: 30_000,
    coverage: {
      provider: 'v8',
      all: false,
      reporter: ['text', 'lcov'],
      thresholds: {
        lines: 70,
        functions: 60,
        branches: 65,
        statements: 70,
      },
    },
  },
});
