// Per-deployment config overlay. This committed stub sets nothing, so the
// build-time (Vite env) config applies — dev server and tests. In a hosted
// container, deploy/nginx/40-runtime-config.sh REPLACES this file at
// startup with `window.__MUNNI_CONFIG__ = {...}` built from the
// container's MUNNI_* env vars (see apps/admin/src/config.ts).
