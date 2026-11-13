import { defineConfig } from 'vitest/config';

export default defineConfig({
  // Alias de tsconfig.json (dont ceux de `nest g library`) : résolution native
  // de Vite, sans plugin.
  resolve: { tsconfigPaths: true },
  test: {
    globals: true,
    root: './',
    include: ['**/*.spec.ts'],
  },
});
