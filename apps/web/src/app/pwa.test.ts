// @vitest-environment happy-dom
import { beforeEach, describe, expect, it, vi } from 'vitest';

let registered: { onNeedRefresh?: () => void } | null = null;
const updateSpy = vi.fn();

// aliased to the stub in vitest.config; mocked here for observability
vi.mock('virtual:pwa-register', () => ({
  registerSW: vi.fn((options: { onNeedRefresh?: () => void }) => {
    registered = options;
    return updateSpy;
  }),
}));

import { handleWorkerMessage, initPwa, usePwa } from './pwa';
import { router } from '@/app/router';
import { useSession } from './session';

describe('handleWorkerMessage (notification deep-link)', () => {
  beforeEach(() => {
    // the app route guard bounces signed-out sessions to /login
    useSession.getState().login({ kind: 'demo' });
  });

  it('routes whitelisted hash targets posted by the worker', async () => {
    handleWorkerMessage({ type: 'NAVIGATE', url: './#/friends' });
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/friends'));
    handleWorkerMessage({ type: 'NAVIGATE', url: './#/spaces' });
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/spaces'));
    // budget alerts land on their detail screen
    handleWorkerMessage({ type: 'NAVIGATE', url: './#/budgets/b42' });
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/budgets/b42'));
  });

  it('re-broadcasts worker PUSH messages as a window event', () => {
    const seen = vi.fn();
    window.addEventListener('munni-push', seen);
    handleWorkerMessage({ type: 'PUSH', payloadType: 'friend-request' });
    expect(seen).toHaveBeenCalledTimes(1);
    window.removeEventListener('munni-push', seen);
  });

  it('ignores junk, foreign message types, and off-whitelist routes', async () => {
    handleWorkerMessage({ type: 'NAVIGATE', url: './#/spaces' });
    await vi.waitFor(() => expect(router.state.location.pathname).toBe('/spaces'));

    handleWorkerMessage(undefined);
    handleWorkerMessage('NAVIGATE');
    handleWorkerMessage({ type: 'SKIP_WAITING' });
    handleWorkerMessage({ type: 'NAVIGATE' }); // no url
    handleWorkerMessage({ type: 'NAVIGATE', url: './#/settings' }); // not a notification target
    handleWorkerMessage({ type: 'NAVIGATE', url: 'https://evil.example/#/friends/../../x' });

    // nothing above may have moved the router
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(router.state.location.pathname).toBe('/spaces');
  });
});

describe('pwa update store', () => {
  beforeEach(() => {
    usePwa.setState({ needRefresh: false, update: () => undefined });
    registered = null;
    updateSpy.mockClear();
  });

  it('starts idle; dismiss clears the flag', () => {
    expect(usePwa.getState().needRefresh).toBe(false);
    usePwa.setState({ needRefresh: true });
    usePwa.getState().dismiss();
    expect(usePwa.getState().needRefresh).toBe(false);
  });

  it('service-worker refresh signal raises the flag and wires update()', () => {
    initPwa();
    expect(registered).toBeTruthy();
    registered!.onNeedRefresh!();
    expect(usePwa.getState().needRefresh).toBe(true);
    usePwa.getState().update();
    expect(updateSpy).toHaveBeenCalledWith(true);
  });
});
