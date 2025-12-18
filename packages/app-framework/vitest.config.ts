import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    globals: true,
    include: ['tests/**/*.test.{ts,tsx}'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'lcov'],
      reportsDirectory: './.coverage',
      exclude: [
        '**/node_modules/**',
        'tests/**',
        'src/**/index.ts',
        'src/frameworks/**',
        'src/seed/cli.ts',
        'src/seed/examples.ts',
      ],
    },
  },
});
