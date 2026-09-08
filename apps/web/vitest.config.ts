import { defineConfig } from 'vitest/config';
import path from 'node:path';

export default defineConfig({
  // vite.config injects the git commit count + package version; tests use stand-ins
  define: { __BUILD_NUMBER__: JSON.stringify('test'), __APP_VERSION__: JSON.stringify('0.0.0-test') },
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
      // Vite-only virtual module — stubbed for unit tests
      'virtual:pwa-register': path.resolve(__dirname, 'src/test/pwa-register-stub.ts'),
    },
  },
  test: {
    // Playwright specs live in tests/ — vitest must not pick them up
    include: ['src/**/*.test.{ts,tsx}'],
    setupFiles: ['src/test/setup.ts'],
    coverage: {
      provider: 'v8',
      include: ['src/**/*.{ts,tsx}'],
      // excluded beyond test/data files: main.tsx (bootstrap wiring — only
      // executes in a real browser boot) and sw.ts (service-worker runtime
      // glue; its decision logic lives in sync/swNotifications + sync/swSync,
      // which ARE tested)
      exclude: [
        'src/**/*.test.{ts,tsx}',
        'src/test/**',
        'src/i18n/**',
        'src/db/demo-data.ts',
        'src/domain/keyword-categories.ts',
        'src/main.tsx',
        'src/sw.ts',
      ],
      reporter: ['text-summary', 'html'],
    },
  },
});
