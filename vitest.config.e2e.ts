import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.e2e-spec.ts'],
    setupFiles: ['./test/helpers/test-env.ts'],
    fileParallelism: false,
    // Le seed e2e lance un processus Node + tsx : plus lent que 5 s par défaut.
    testTimeout: 30_000,
  },
});
