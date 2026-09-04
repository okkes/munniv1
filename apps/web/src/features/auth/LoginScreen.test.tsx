// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { readSessionIdentity } from '@/app/session';
import { renderApp } from '@/test/harness';

// Local-first law also applies to demo/offline sign-in: zero network.
const fetchSpy = vi.fn(() => Promise.reject(new Error('network disabled in test')));

// deterministic regardless of the developer's .env.local
vi.mock('@/app/config', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/app/config')>()),
  logtoConfigured: false,
}));

describe('LoginScreen', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
  });

  it('demo button signs in and lands on home without network calls', async () => {
    renderApp('/login', { signedIn: false });
    fireEvent.click(await screen.findByTestId('login-demo-btn'));
    expect(await screen.findByTestId('screen-home')).toBeTruthy();
    expect(readSessionIdentity()).toEqual({ kind: 'demo' });
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('creates an offline profile and enters a personal space named after it', async () => {
    renderApp('/login', { signedIn: false });
    fireEvent.click(await screen.findByTestId('login-offline-btn'));
    // step 1: the trade-off screen (info only, no profiles yet)
    expect(await screen.findByTestId('screen-offline-intro')).toBeTruthy();
    expect(screen.getByTestId('offline-keep-card')).toBeTruthy();
    expect(screen.getByTestId('offline-lose-card')).toBeTruthy();
    expect(screen.queryByTestId('offline-name')).toBeNull();
    // browser back leaves the offline screen (login modes honor popstate)
    fireEvent.popState(window);
    expect(screen.queryByTestId('screen-offline-intro')).toBeNull();
    fireEvent.click(screen.getByTestId('login-offline-btn'));
    // step 2: profiles live on their own screen behind Continue
    fireEvent.click(screen.getByTestId('offline-continue'));
    expect(await screen.findByTestId('screen-offline-profiles')).toBeTruthy();
    const name = await screen.findByTestId('offline-name');
    expect((screen.getByTestId('offline-create') as HTMLButtonElement).disabled).toBe(true);
    fireEvent.change(name, { target: { value: 'Okkes' } });
    fireEvent.click(screen.getByTestId('offline-create'));

    // offline users get the same first-run setup (user ruling): name is
    // prefilled from the profile; finish it to reach home
    await screen.findByTestId('screen-onboarding');
    await waitFor(() => expect((screen.getByTestId('onboarding-name') as HTMLInputElement).value).toBe('Okkes'));
    fireEvent.click(screen.getByTestId('onboarding-save'));
    fireEvent.click(await screen.findByTestId('onboarding-lock-later'));
    expect(await screen.findByTestId('screen-home')).toBeTruthy();
    const identity = readSessionIdentity();
    expect(identity?.kind).toBe('offline');
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('a SECOND profile passes Mina’s heads-up first (arc 8)', async () => {
    localStorage.setItem('munni_offline_profiles', JSON.stringify([{ id: 'p1', name: 'Okkes', createdAt: 1 }]));
    renderApp('/login', { signedIn: false });
    fireEvent.click(await screen.findByTestId('login-offline-btn'));
    fireEvent.click(screen.getByTestId('offline-continue'));
    await screen.findByTestId('screen-offline-profiles');

    // the existing world is offered AND the add row stays available
    expect(screen.getByTestId('offline-profile-p1')).toBeTruthy();
    fireEvent.change(screen.getByTestId('offline-name'), { target: { value: 'Partner' } });
    fireEvent.click(screen.getByTestId('offline-create'));

    // Mina explains separate worlds; Go back changes nothing
    await screen.findByTestId('mina-profiles-ask');
    fireEvent.click(screen.getByTestId('mina-profiles-back'));
    await waitFor(() => expect(screen.queryByTestId('mina-profiles-ask')).toBeNull());
    expect(JSON.parse(localStorage.getItem('munni_offline_profiles')!)).toHaveLength(1);

    // Continue mints the second world and enters it
    fireEvent.click(screen.getByTestId('offline-create'));
    await screen.findByTestId('mina-profiles-ask');
    fireEvent.click(screen.getByTestId('mina-profiles-continue'));
    await waitFor(() => {
      const profiles = JSON.parse(localStorage.getItem('munni_offline_profiles')!) as { name: string }[];
      expect(profiles.map((p) => p.name)).toEqual(['Okkes', 'Partner']);
    });
    expect(readSessionIdentity()?.kind).toBe('offline');
    expect(fetchSpy).not.toHaveBeenCalled();
  }, 15_000);

  it('the language pill switches the UI language and persists it', async () => {
    renderApp('/login', { signedIn: false });
    fireEvent.click(await screen.findByTestId('login-lang-trigger'));
    fireEvent.click(await screen.findByTestId('login-lang-nl'));
    await waitFor(() => expect(screen.getByTestId('login-demo-btn').textContent).toContain('demo'));
    expect(localStorage.getItem('munni_lang')).toBe('nl');
    expect(fetchSpy).not.toHaveBeenCalled(); // language art/data is bundled
  });

  it('unavailable providers are hidden when Logto is not configured', async () => {
    renderApp('/login', { signedIn: false });
    await screen.findByTestId('login-demo-btn');
    expect(screen.queryByTestId('login-google-btn')).toBeNull();
    expect(screen.queryByTestId('login-apple-btn')).toBeNull();
    expect(screen.queryByTestId('login-signin-btn')).toBeNull();
  });

  it('an existing offline profile is offered on the next visit and keeps its data', async () => {
    // first visit: create the profile
    const first = renderApp('/login', { signedIn: false });
    fireEvent.click(await screen.findByTestId('login-offline-btn'));
    fireEvent.click(await screen.findByTestId('offline-continue'));
    fireEvent.change(await screen.findByTestId('offline-name'), { target: { value: 'Okkes' } });
    fireEvent.click(screen.getByTestId('offline-create'));
    await screen.findByTestId('screen-onboarding');
    fireEvent.click(screen.getByTestId('onboarding-save'));
    fireEvent.click(await screen.findByTestId('onboarding-lock-later'));
    await screen.findByTestId('screen-home');
    const identity = readSessionIdentity();
    first.unmount();

    // sign out (session cleared) but local data must survive for offline profiles
    localStorage.removeItem('munni_session');
    renderApp('/login', { signedIn: false });
    fireEvent.click(await screen.findByTestId('login-offline-btn'));
    fireEvent.click(await screen.findByTestId('offline-continue'));
    const profileBtn = await screen.findByText('Okkes');
    // deletion moved to Settings → Profile (user ruling 2026-07-29) —
    // the chooser offers no destructive affordance any more
    expect(document.querySelector('[data-testid^="offline-delete-"]')).toBeNull();
    fireEvent.click(profileBtn.closest('button')!);
    expect(await screen.findByTestId('screen-home')).toBeTruthy();
    await waitFor(() => expect(readSessionIdentity()).toEqual(identity));
  });
});