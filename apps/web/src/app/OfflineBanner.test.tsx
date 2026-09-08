// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { USER_TEST_DB, renderAppAsUser } from '@/test/harness';
import { resolveOfflineReason } from './OfflineBanner';

describe('resolveOfflineReason', () => {
  it('is silent for local-only identities (no engine) — offline mode is a choice', () => {
    expect(resolveOfflineReason(false, false, 'offline')).toBeNull();
    expect(resolveOfflineReason(false, true, 'error')).toBeNull();
  });

  it('reports no-network the moment connectivity is gone, before sync fails', () => {
    expect(resolveOfflineReason(true, false, 'idle')).toBe('no-network');
    expect(resolveOfflineReason(true, false, 'error')).toBe('no-network');
  });

  it('reports unreachable when the network is up but sync cannot reach the server', () => {
    expect(resolveOfflineReason(true, true, 'offline')).toBe('unreachable');
    expect(resolveOfflineReason(true, true, 'error')).toBe('unreachable');
  });

  it('stays hidden while syncing works', () => {
    expect(resolveOfflineReason(true, true, 'idle')).toBeNull();
    expect(resolveOfflineReason(true, true, 'syncing')).toBeNull();
  });

  it('a version mismatch outranks everything — the server IS reachable, sync is refused', () => {
    expect(resolveOfflineReason(true, true, 'error', 'client-outdated')).toBe('client-outdated');
    expect(resolveOfflineReason(true, false, 'error', 'server-outdated')).toBe('server-outdated');
    expect(resolveOfflineReason(false, true, 'error', 'client-outdated')).toBeNull(); // still silent without an engine
  });
});

describe('offline banner + home indicator', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase(USER_TEST_DB);
    vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false);
  });

  it('dismiss hides the banner for the session; the home pill stays', async () => {
    renderAppAsUser('/home');
    await screen.findByTestId('screen-home');

    const banner = await screen.findByTestId('offline-banner');
    expect(banner.getAttribute('data-reason')).toBe('no-network');
    expect(screen.getByTestId('home-offline-indicator')).toBeTruthy();

    fireEvent.click(screen.getByTestId('offline-banner-dismiss'));
    expect(screen.queryByTestId('offline-banner')).toBeNull();
    // the quiet indicator is the persistent signal after dismissal
    expect(screen.getByTestId('home-offline-indicator')).toBeTruthy();
    expect(sessionStorage.getItem('munni_offline_banner_dismissed')).toBe('1');
  });

  it('stays dismissed on remount within the same session', async () => {
    sessionStorage.setItem('munni_offline_banner_dismissed', '1');
    renderAppAsUser('/home');
    await screen.findByTestId('screen-home');
    expect(await screen.findByTestId('home-offline-indicator')).toBeTruthy();
    expect(screen.queryByTestId('offline-banner')).toBeNull();
  });
});
