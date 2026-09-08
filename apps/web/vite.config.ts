import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { VitePWA } from 'vite-plugin-pwa';
import { execSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import path from 'node:path';

export default defineConfig(({ mode }) => {
  let buildNumber: number | string = 'dev';
  if (mode === 'production') {
    try {
      buildNumber = Number.parseInt(execSync('git rev-list --count HEAD').toString().trim(), 10); // NOSONAR(S4036) build-time git, trusted environment
    } catch {
      buildNumber = 0;
    }
  }

  // staging installs wear the white leaf on brand green so both apps can
  // live on one home screen; production keeps the dark leaf on cream
  const staging = process.env.VITE_CHANNEL === 'staging';
  const icon = (size: number) => (staging ? `icon-staging-${size}.png` : `icon-${size}.png`);

  return {
    plugins: [
      react(),
      tailwindcss(),
      VitePWA({
        // custom worker: precaching + Web Push handlers (src/sw.ts)
        strategies: 'injectManifest',
        srcDir: 'src',
        filename: 'sw.ts',
        registerType: 'prompt',
        includeAssets: ['favicon.ico', icon(192), icon(512)],
        manifest: {
          name: 'munni — finance app',
          short_name: 'munni',
          description: 'Personal finance made simple',
          theme_color: '#08372B',
          background_color: staging ? '#08372B' : '#F7F4EE',
          display: 'standalone',
          orientation: 'portrait',
          start_url: './',
          scope: './',
          id: './',
          icons: [
            { src: icon(192), sizes: '192x192', type: 'image/png', purpose: 'any' },
            { src: icon(192), sizes: '192x192', type: 'image/png', purpose: 'maskable' },
            { src: icon(512), sizes: '512x512', type: 'image/png', purpose: 'any' },
            { src: icon(512), sizes: '512x512', type: 'image/png', purpose: 'maskable' },
          ],
        },
        injectManifest: {
          // json matters: the vendored brand SVGs were precached but their
          // index (brands/index.json) was not — offline installs showed an
          // empty logo picker. jpg: the bundled event pictures must work
          // offline/demo too.
          globPatterns: ['**/*.{js,css,html,ico,png,svg,json,woff2,jpg}'],
          maximumFileSizeToCacheInBytes: 4 * 1024 * 1024,
          // iife, NOT the default es: the worker is registered as a classic
          // script, but the es build kept `import.meta` (dynamic-import
          // helpers, catalog-baseline import) — browsers threw
          // "Cannot use 'import.meta' outside a module" at parse time and
          // production ran with NO service worker at all: no offline, no
          // web push (user ss 2026-07-19). iife inlines every chunk.
          rollupFormat: 'iife',
        },
      }),
      {
        // iOS home-screen installs read apple-touch-icon, not (reliably)
        // the manifest icons — inject the channel's leaf
        name: 'munni:apple-touch-icon',
        transformIndexHtml: () => [
          { tag: 'link', attrs: { rel: 'apple-touch-icon', sizes: '192x192', href: icon(192) }, injectTo: 'head' as const },
        ],
      },
      {
        // the native shells poll this to learn a newer release shipped:
        // web deploys and store binaries are stamped with the same git
        // commit count, so build > shell build ⇒ an update exists
        name: 'munni:version-json',
        generateBundle() {
          this.emitFile({
            type: 'asset',
            fileName: 'version.json',
            source: JSON.stringify({
              build: buildNumber,
              version: (JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as { version: string }).version,
            }),
          });
        },
      },
    ],
    resolve: {
      alias: {
        '@': path.resolve(__dirname, 'src'),
      },
    },
    base: './',
    build: {
      outDir: 'dist',
      assetsInlineLimit: 0,
    },
    define: {
      __BUILD_NUMBER__: JSON.stringify(buildNumber),
      // release-please bumps package.json; Settings shows it as vX.Y.Z
      __APP_VERSION__: JSON.stringify(
        (JSON.parse(readFileSync(path.resolve(__dirname, 'package.json'), 'utf8')) as { version: string }).version,
      ),
    },
  };
});
