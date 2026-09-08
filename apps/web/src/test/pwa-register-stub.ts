// vitest stand-in for the Vite-only 'virtual:pwa-register' module.
export function registerSW(_options?: { onNeedRefresh?: () => void }): (reload?: boolean) => Promise<void> {
  return async () => undefined;
}
