import { defineConfig } from '@playwright/test';

// Set by the dockerized WebKit guard (deploy/webkit-e2e.ps1): the app is
// served externally (its own static server inside the container), so the
// vite webServer must not start.
const externalBaseUrl = process.env.PW_BASE_URL;

export default defineConfig({
  testDir: 'tests/specs',
  workers: process.env.CI ? 3 : 2, // CI: 3; local: 2 (more workers overwhelm vite dev server)
  outputDir: 'tests/results',
  projects: [
    // the gallery suite (screenshots + flows) — chromium, as always
    { name: 'gallery', testMatch: '**/*.gallery.spec.js', use: { browserName: 'chromium' as const } },
    // WebKit engine guard (all of iOS is WebKit; Blink hides its layout
    // bugs). Only defined where the browser actually exists — CI and the
    // dockerized runner — so host runs never trip over a missing binary.
    ...(process.env.CI || process.env.PW_WEBKIT
      ? [{ name: 'webkit', testMatch: '**/*.webkit.spec.js', use: { browserName: 'webkit' as const } }]
      : []),
  ],
  use: {
    // dedicated e2e port: never collides with the user's dev server (5173)
    baseURL: externalBaseUrl ?? 'http://localhost:5174',
    screenshot: 'only-on-failure',
    trace: 'on-first-retry',
  },
  ...(externalBaseUrl
    ? {}
    : {
        webServer: {
          command: 'npm run dev -- --port 5174 --strictPort',
          url: 'http://localhost:5174',
          reuseExistingServer: true,
          stdout: 'ignore',
          stderr: 'pipe',
          env: {
            // e2e talks to the header-auth test API (deploy/docker-compose.test.yml)
            VITE_API_URL: 'http://localhost:8181',
          },
        },
      }),
  reporter: [['list']],
});
