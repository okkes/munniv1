import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import { useLang } from '@/i18n';
import { Icon } from '@/ui/Icon';
import { identityDbName } from '@/db/schema';
import type { StorageBackend } from '@/db/backend';
import { destroyStorage, openStorageBackend } from '@/db/openStore';
import { Repo } from '@/db/repo';
import { setPredictionCountry } from '@/domain/predictCategory';
import { getClock, getDeviceId } from '@/db/device';
import { seedDemoIfNeeded } from '@/db/seed';
import { ApiSyncBackend } from '@/sync/backend';
import { SyncEngine } from '@/sync/engine';
import { config } from './config';
import { requestOutboxSync } from './pwa';
import { clearSwSession, jwtExpiryMs, mirrorSessionForSw } from '@/lib/swBridge';
import { ensurePersistentStorage } from '@/lib/platform';
import { getAccessToken, oidcSignIn, waitForAuthReady } from './authToken';
import { LOGTO_WIPE_KEY } from '@/lib/authState';
import { identityKey, useSession } from './session';
import type { Identity } from './session';
import { useEvicted } from './evicted';

const ACTIVE_SPACE_KEY = 'activeSpaceId';
/** id of a personal space this device created during bootstrap (self-heal marker) */
const BOOTSTRAP_SPACE_KEY = 'bootstrapSpaceId';

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/** the identity's non-deleted spaces */
const liveSpaces = async (store: StorageBackend) => (await store.allRows('space')).filter((s) => s.deleted === 0);

/**
 * First-run bootstrap for syncing identities — FAIL CLOSED: a personal
 * space is only ever created after the server CONFIRMED this account has
 * no spaces. Network/auth failures retry with backoff instead of
 * spawning an empty duplicate space (an early bug that stranded devices
 * on a blank copy). Existing local data always loads without a server.
 */
export async function bootstrapUserSpaces(
  store: StorageBackend,
  repo: Repo,
  engine: SyncEngine,
  isCancelled: () => boolean,
  baseRetryMs = 2_000,
  onAttemptFailed?: (attempt: number) => void,
): Promise<void> {
  const hasLocalSpaces = async () => (await liveSpaces(store)).length > 0;

  for (let attempt = 0; ; attempt++) {
    await engine.syncAll().catch(() => undefined);
    if (engine.getStatus() !== 'error' && engine.getStatus() !== 'offline') break; // server confirmed our spaces
    if (await hasLocalSpaces()) return; // offline but usable — local-first
    // brand-new device with nothing local: keep trying, capped backoff —
    // and tell the UI, so a broken server/proxy is visible, not a spinner
    onAttemptFailed?.(attempt + 1);
    await sleep(Math.min(baseRetryMs * 2 ** attempt, baseRetryMs * 8));
    if (isCancelled()) return;
  }

  // a CANCELLED instance must never write: StrictMode/HMR double-mounts
  // run two bootstraps against the SAME database, and the stale one's
  // slow first sync used to re-set needsOnboarding AFTER the user had
  // already finished onboarding — ambushing the app mid-use
  if (isCancelled()) return;

  if (!(await hasLocalSpaces())) {
    // server confirmed: brand-new user. NO space is created any more
    // (Mina tutorial, user ruling): the ≥1-space rule is suspended until
    // the tutorial's create-step (or its skip path) provides one.
    // RE-ENTRANCY GUARD: without a created space this branch used to
    // fire again on every start (and on a slow first confirm AFTER the
    // user already finished onboarding — the ambush bug, second coming);
    // any Mina marker means the first-run is already owned.
    if (!(await minaMarkerExists(store))) {
      await store.metaPut('needsOnboarding', true);
      await store.metaPut('minaTutorialPending', true);
    }
    return;
  }

  await retireEmptyBootstrapSpace(store, repo);
}

/** self-heal: a bootstrap-created space still empty while the account's
 *  real spaces arrived (pre-fix duplicates) retires quietly. #221: the
 *  eagerly minted defaults don't count as content — and they leave with
 *  the space instead of lingering as orphans. */
async function retireEmptyBootstrapSpace(store: StorageBackend, repo: Repo): Promise<void> {
  const bootstrapId = (await store.metaGet(BOOTSTRAP_SPACE_KEY))?.value as string | undefined;
  if (!bootstrapId) return;
  const others = (await liveSpaces(store)).filter((s) => s.id !== bootstrapId).length;
  if (others === 0) return;
  const [txs, accounts, cats] = await Promise.all([
    store.countBySpace('transaction', bootstrapId),
    store.bySpace('account', bootstrapId),
    store.countBySpace('category', bootstrapId),
  ]);
  const realAccounts = accounts.filter((a) => a.deleted === 0 && !a.defaultFor);
  if (txs === 0 && realAccounts.length === 0 && cats === 0) {
    for (const account of accounts.filter((a) => a.deleted === 0)) {
      await repo.remove('account', bootstrapId, account.id);
    }
    await repo.remove('space', bootstrapId, bootstrapId);
  }
  await store.metaDelete(BOOTSTRAP_SPACE_KEY);
}

/** any Mina meta marker: the first-run is already owned/ran/finished */
async function minaMarkerExists(store: StorageBackend): Promise<boolean> {
  for (const key of ['minaTutorialPending', 'minaTutorialState', 'minaTutorialDone']) {
    if ((await store.metaGet(key))?.value) return true;
  }
  return false;
}

/** zero spaces is LEGAL only while the Mina tutorial owns the first-run
 *  (user ruling) — anything else stays a hard bug */
async function minaOwnsFirstRun(store: StorageBackend): Promise<boolean> {
  if ((await store.metaGet('minaTutorialPending'))?.value) return true;
  const state = (await store.metaGet('minaTutorialState'))?.value as { active?: boolean } | undefined;
  return !!state?.active;
}

/** OIDC restore → fail-closed bootstrap → periodic sync (user identities) */
async function restoreAndSync(
  store: StorageBackend,
  repo: Repo,
  engine: SyncEngine,
  isCancelled: () => boolean,
  onAttempts: (n: number) => void,
): Promise<void> {
  await waitForAuthReady();
  if (isCancelled()) return;
  await bootstrapUserSpaces(store, repo, engine, isCancelled, undefined, onAttempts);
  if (isCancelled()) return;
  onAttempts(0);
  engine.start();
}

/** the sync stack of a signed-in user identity (token mirroring included) */
function buildSyncEngine(identity: Extract<Identity, { kind: 'user' }>, store: StorageBackend, repo: Repo): SyncEngine {
  const key = identityKey(identity);
  const backend = new ApiSyncBackend({
    baseUrl: config.apiUrl,
    getAuth: async () => {
      if (identity.testAuth) {
        mirrorSessionForSw({ apiUrl: config.apiUrl, identityKey: key, testSub: identity.sub });
        return { testSub: identity.sub };
      }
      const bearer = await getAccessToken();
      // mirror the fresh token for the worker's background sync
      // (push-triggered pull + Android outbox flush, app killed)
      if (bearer) {
        mirrorSessionForSw({
          apiUrl: config.apiUrl,
          identityKey: key,
          bearer,
          expiresAt: jwtExpiryMs(bearer) ?? Date.now() + 10 * 60_000,
        });
      }
      return { bearer };
    },
  });
  return new SyncEngine(store, repo, backend, getDeviceId());
}

interface DataContextValue {
  /** the storage seam (E1) — all reads/writes go through this */
  store: StorageBackend;
  repo: Repo;
  /** the currently active space */
  spaceId: string;
  setActiveSpace: (spaceId: string) => Promise<void>;
  /** present only for syncing (user) identities */
  engine: SyncEngine | null;
}

const DataContext = createContext<DataContextValue | null>(null);

/**
 * Opens the identity's database (seeding demo data on first use), resolves
 * the active space, and provides db/repo to the screens. Renders nothing
 * until ready so screens never flash empty state.
 */
export function DataProvider({ children }: { children: ReactNode }) {
  const identity = useSession((s) => s.identity);
  const [state, setState] = useState<{
    store: StorageBackend;
    repo: Repo;
    spaceId: string;
    engine: SyncEngine | null;
  } | null>(null);
  const [failedAttempts, setFailedAttempts] = useState(0);
  const [connectError, setConnectError] = useState<string | null>(null);

  useEffect(() => {
    if (!identity) {
      setState(null);
      clearSwSession(); // signed out: background sync stops immediately
      return;
    }
    let cancelled = false;
    const isCancelled = () => cancelled;
    const onAttempts = (n: number) => {
      if (!cancelled) {
        setFailedAttempts(n);
        setConnectError(engine?.lastError ?? null);
      }
    };
    let engine: SyncEngine | null = null;
    let openedStore: StorageBackend | null = null;

    void (async () => {
      // E2: the backend is chosen here — Dexie, or SQLCipher when the
      // native dev flag is on (openStore.ts) — hence the async open
      const store = await openStorageBackend(identityDbName(identityKey(identity)));
      if (cancelled) {
        store.close();
        return;
      }
      openedStore = store;
      const syncing = identity.kind === 'user';
      const repo = new Repo(store, getClock(), {
        trackOutbox: syncing, // demo/offline never sync — no outbox
        onWrite: () => engine?.nudge(),
      });
      if (syncing) {
        // operator catalog: cheap ETag revalidation, then apply any
        // tombstones exactly once per version — all fire-and-forget
        void (async () => {
          const { cachedCatalog, refreshCatalog } = await import('@/sync/catalogSync');
          await refreshCatalog(store);
          const { applyCatalogTombstones } = await import('@/application/catalogMaintenance');
          await applyCatalogTombstones(store, repo);
          // R9: operator-curated store fingerprints feed the receipt matcher
          const { setCatalogStorePatterns } = await import('@/domain/storeReceipts');
          setCatalogStorePatterns((await cachedCatalog(store))?.stores ?? []);
        })().catch(() => undefined);
        // reinstall gap: the Settings avatar reads the local profile copy —
        // hydrate it from /me when missing (fire-and-forget)
        void (async () => {
          const { hydrateProfileMeta } = await import('@/application/profileHydrate');
          await hydrateProfileMeta(store);
        })().catch(() => undefined);
        // receipts v2 → v3: fan-out rows become global rows + snapshot
        // links, once per identity (fire-and-forget, retried while offline)
        void (async () => {
          const { migrateLegacyReceipts } = await import('@/application/receiptsMigrate');
          await migrateLegacyReceipts(store, repo);
        })().catch(() => undefined);
        engine = buildSyncEngine(identity, store, repo);
        // pushes failing (offline / server away) — arm the background
        // flush so the outbox drains even if the app is killed meanwhile
        engine.onStatus((status) => {
          if (status === 'offline' || status === 'error') requestOutboxSync();
        });
        // remote-wipe: if this account was deleted (or went offline) on
        // ANOTHER device, the /me binding mismatch wipes this copy too
        void enforceAccountBinding(store, identity).catch(() => undefined);
        // remote disconnect (logged-in devices, user ruling: disconnect =
        // wipe): the api choke point saw a 410 device-revoked — erase
        // this copy exactly like the binding wipe would
        revokedWipeIdentity = identity;
        globalThis.removeEventListener('munni:device-revoked', onDeviceRevoked);
        globalThis.addEventListener('munni:device-revoked', onDeviceRevoked);
      }

      // ask the browser not to evict our data (iOS 7-day ITP wipe etc.);
      // best-effort — installed PWAs are exempt, native storage is app-scoped
      if (identity.kind !== 'demo') void ensurePersistentStorage();
      if (identity.kind === 'demo') await seedDemoIfNeeded(repo);
      // boot maintenance chain: marker-gated one-shots plus the
      // every-boot heals (ALL identities — demo/offline data too)
      const bootChain = (async () => {
        const { normalizeReimbursements, migrateRetiredDebtSubs, migrateFundingRows, migrateCatSpreads, migrateCounterFiledTransfers, migrateInvestMovementSubs } = await import('@/application/catalogMaintenance');
        // kind simplification: counterparty-less transfer-family rows
        // become plain income/expense by sign (marker-gated, all
        // identities; arc-2 bare labels wear their locked sub and skip)
        // heal rows the pre-2026-07-28 bulk-apply typed against their sign
        // arc 2 back-fill: placeholder-categorized transfer-family rows
        // file the sign-picked locked sub ("Set aside" over a blank line)
        // retired debt subs (lendMoney/creditCardPayment) refile by sign
        await migrateRetiredDebtSubs(store, repo);
        // #252: Bought/Sold became brokerage-internal — unstamped
        // movement legs refile to Invested/Withdrawn (one-shot)
        await migrateInvestMovementSubs(store, repo);
        // typed-splits v2: the funding TYPE retires into its category…
        await migrateFundingRows(store, repo);
        // #211: splits mean PARTS — legacy bare category slices fold
        // into the row's own `cats` partition (after the settled-slice
        // normalization above, so the gross invariant already holds)
        await migrateCatSpreads(store, repo);
        // #228: ONE counterparty per (split) transaction — entry-level
        // links relocate to their row/part, and spreads mixing a special
        // category become real splits. Every boot: an old offline device
        // may sync the retired per-entry shape in at any time. BEFORE
        // the r5 refile, so that one only ever meets row/part links.
        const { migrateEntryCounters } = await import('@/application/categoryModel');
        await migrateEntryCounters(store, repo);
        // #133 r5: Transfer filed toward a SPECIAL counterparty refiles
        // as the family's movement sub (the bijection) — rows and parts
        // (the fold above already moved every entry-level link)
        await migrateCounterFiledTransfers(store, repo);
        // #228: reimbursement on a SPLIT transaction stays on the split.
        // Every boot: links name their parts, each part settles inside
        // its own cats, the retired container-level pseudo-part shape
        // (it drained the WRONG sibling) strips and heals.
        await normalizeReimbursements(store, repo);
        // …and linked family rows invert — regular leg = transfer with
        // the locked cat, the manual counter's mirror minted (no delta:
        // the old lane already moved the balance at link time)
        // #259: gateless links (the server's connect mirror op carries
        // no historyFrom) take the space's start date — every boot, so
        // links that sync in AFTER a device's first boot heal too
        const { healGatelessLinks } = await import('@/application/historyStart');
        await healGatelessLinks(store, repo);
        // #212 r2: the SPACE owns an attached account's type — typeless
        // links freeze today's effective reading so the server's per-
        // fetch 'checking' re-assert can't flip a space's books
        const { healUntypedLinks } = await import('@/application/accountAttach');
        await healUntypedLinks(store, repo);
        // loans v2: debt rows fold into their liability account (every
        // boot, idempotent — late-syncing debts from old devices heal)
        const { foldDebtsIntoAccounts } = await import('@/application/debts');
        await foldDebtsIntoAccounts(store, repo);
        // #221: every live space carries its six default accounts (every
        // boot, idempotent — pre-#221 spaces and old-device deletes heal)
        const { ensureAllDefaultAccounts } = await import('@/application/defaultAccounts');
        await ensureAllDefaultAccounts(store, repo);
        // #133 ruling 3 / #221: bare movement rows link onto the DEFAULT
        // accounts — balances move via the mirror lifecycle. Every boot:
        // the server keeps writing keyword-predicted movement categories
        // (GcIngest) with no counterparty, so this heals continuously.
        const { migrateBareSpecialRows } = await import('@/application/categoryModel');
        await migrateBareSpecialRows(store, repo);
        // transfers are ONE event with two legs — pair them within each
        // space's own books (never across: funding covers that case)
        const { linkTransferPairs } = await import('@/application/transferMatch');
        await linkTransferPairs(store, repo);
      })().catch(() => undefined);
      // test seam: the chain writes fire-and-forget, and a test that
      // deletes the database while a PREVIOUS boot's chain still holds
      // the connection boots the next app on a dying handle (its live
      // queries collapse mid-test). Tests drain this before deleting.
      if (import.meta.env.VITEST) (globalThis as { __munniBootChain?: Promise<unknown> }).__munniBootChain = bootChain;
      void bootChain;
      // bank-connect completions attach server-side from an anonymous
      // page — mirror any link no device ever saw being made (also heals
      // the historic "connected but shows up nowhere" danglers)
      if (identity.kind === 'user') void mirrorSpaceLinks(store, repo).catch(() => undefined);
      if (identity.kind === 'offline' && (await liveSpaces(store)).length === 0) {
        // fully local profile, same Mina flow as online (user ruling):
        // no auto-created space — the tutorial's create-step (or its
        // skip path) provides the first one
        await store.metaPut('needsOnboarding', true);
        await store.metaPut('minaTutorialPending', true);
      }
      // country of use tunes the category predictor (onboarding stores it)
      {
        const profile = (await store.metaGet('profile'))?.value as { country?: string } | undefined;
        setPredictionCountry(profile?.country);
      }
      if (engine) {
        const eng = engine;
        const finishSync = () => restoreAndSync(store, repo, eng, isCancelled, onAttempts);
        if ((await liveSpaces(store)).length > 0) {
          // returning device: local-first — render from what's stored NOW;
          // auth restore + first sync catch up in the background. A dead
          // server or unreachable OIDC endpoint must never block the UI
          // (it did: a hanging fetch kept users on the connecting screen
          // despite a fully usable local database).
          void finishSync().catch(() => undefined);
        } else {
          // brand-new device: nothing to show — wait for the server to
          // confirm the account state (fail-closed bootstrap)
          await finishSync();
        }
      }
      const stored = (await store.metaGet(ACTIVE_SPACE_KEY))?.value as string | undefined;
      const spaces = await liveSpaces(store);
      const spaceId = spaces.find((s) => s.id === stored)?.id ?? spaces[0]?.id;
      if (!spaceId && !(await minaOwnsFirstRun(store))) throw new Error('no space available after seed');
      if (!cancelled) setState({ store, repo, spaceId: spaceId ?? '', engine });
    })().catch((err) => {
      // StrictMode double-mount closes the first db mid-seed — expected
      if (!cancelled) throw err;
    });
    return () => {
      cancelled = true;
      engine?.stop();
      openedStore?.close();
    };
  }, [identity]);

  const setActiveSpace = useCallback(
    async (spaceId: string) => {
      if (!state) return;
      await state.store.metaPut(ACTIVE_SPACE_KEY, spaceId);
      setState((prev) => (prev ? { ...prev, spaceId } : prev));
    },
    [state],
  );

  // #173 (user): an eviction of the ACTIVE space hops to a surviving one
  // right away — before this, screens just read undefined until the next
  // full boot silently preselected spaces[0]
  const evicted = useEvicted((s) => s.evicted);
  useEffect(() => {
    if (!evicted || !state || evicted.spaceId !== state.spaceId) return;
    void (async () => {
      const next = (await liveSpaces(state.store)).find((s) => s.id !== evicted.spaceId);
      if (next) {
        useEvicted.getState().markSwitched(next.name);
        await setActiveSpace(next.id);
      }
    })();
  }, [evicted, state, setActiveSpace]);

  const value = useMemo(() => (state ? { ...state, setActiveSpace } : null), [state, setActiveSpace]);

  if (!identity) return null;
  if (!value) return <ConnectingScreen failedAttempts={failedAttempts} errorDetail={connectError} />;
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

/** server links → local accountLink mirrors, every member space in turn */
async function mirrorSpaceLinks(store: StorageBackend, repo: Repo): Promise<void> {
  const { reconcileSpaceLinks } = await import('@/application/accountAttach');
  for (const space of await liveSpaces(store)) {
    await reconcileSpaceLinks(store, repo, space.id).catch(() => undefined);
  }
}

/**
 * Shown while the database opens (instant) or a brand-new device waits
 * for the server during bootstrap (can take a while offline) — the
 * message only appears once it's clearly the latter. After repeated
 * failed rounds the screen names the problem (broken API/proxy is a
 * config error, not a loading state) and offers a way out.
 */
const REHEAL_KEY = 'munni_auth_reheal';

function ConnectingScreen({ failedAttempts = 0, errorDetail }: { failedAttempts?: number; errorDetail?: string | null }) {
  const { t } = useLang();
  const logout = useSession((s) => s.logout);
  const identity = useSession((s) => s.identity);
  // SELF-HEAL (iOS field 401, 2026-07-29): signed-in user + 401s + NO
  // mintable token = the client-side Logto keys are gone while the IdP
  // session cookie usually survives — a silent re-sign-in round-trip
  // re-mints them. Capped per tab so a dead IdP session cannot loop; at
  // the cap the screen keeps its Sign out / Diagnose exits.
  useEffect(() => {
    if (identity?.kind !== 'user' || identity.testAuth) return;
    if (!(errorDetail ?? '').includes('401')) return;
    void (async () => {
      if (await getAccessToken()) {
        sessionStorage.removeItem(REHEAL_KEY); // tokens mint — the 401 is not evicted state
        return;
      }
      const attempts = Number(sessionStorage.getItem(REHEAL_KEY) ?? '0');
      if (attempts >= 2) return;
      sessionStorage.setItem(REHEAL_KEY, String(attempts + 1));
      const { callbackUri } = await import('@/features/auth/logto');
      if (!(await oidcSignIn(callbackUri()))) sessionStorage.removeItem(REHEAL_KEY);
    })();
  }, [identity, errorDetail]);
  const [slow, setSlow] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setSlow(true), 1_500);
    return () => clearTimeout(timer);
  }, []);
  // 401s during a fresh sign-in are the auth path's business (token
  // mirroring/JIT settle within seconds and it recovers on its own) —
  // flashing "can't reach the server" + a Sign out button at a brand-new
  // user was scary enough to get clicked (user report). But patience has
  // an END: on iOS the 401s never settled and this screen sat forever
  // (user ss 2026-07-28) — past 20s the truth beats the calm.
  const [patienceOver, setPatienceOver] = useState(false);
  useEffect(() => {
    const timer = setTimeout(() => setPatienceOver(true), 20_000);
    return () => clearTimeout(timer);
  }, []);
  const authSettling = (errorDetail ?? '').includes('401') && !patienceOver;
  const unreachable = (failedAttempts >= 2 && !authSettling) || (patienceOver && failedAttempts >= 1);
  // the stuck platform is iOS-only, where DevTools are out of reach — a
  // built-in probe produces a copyable report instead (user: "I don't
  // know how to provide you info")
  const [report, setReport] = useState<string | null>(null);
  const diagnose = async () => {
    // key SUFFIXES only (idToken/refreshToken/accessToken/signInSession) —
    // discriminates "exchange never persisted" vs "refresh gone" vs
    // "signInSession stranded"; never values
    const logtoSuffixes = (store: Storage) => {
      const names = Object.keys(store)
        .filter((k) => k.startsWith('logto:'))
        .map((k) => k.split(':').pop() ?? '');
      return names.join(',') || '-';
    };
    const lines = [
      `build: v${__APP_VERSION__} (${String(__BUILD_NUMBER__)})`,
      `ua: ${navigator.userAgent}`,
      `standalone: ${window.matchMedia?.('(display-mode: standalone)')?.matches ?? false}`,
      `online: ${navigator.onLine}`,
      `sw: ${navigator.serviceWorker?.controller ? 'controlling' : 'none'}`,
      `session: ${identity?.kind ?? 'absent'}`,
      `logtoKeys: ${Object.keys(localStorage).filter((k) => k.startsWith('logto:')).length}`,
      `logtoLs: ${logtoSuffixes(localStorage)}`,
      `logtoSs: ${logtoSuffixes(sessionStorage)}`,
      `lsKeys: ${Object.keys(localStorage).length} ssKeys: ${Object.keys(sessionStorage).length}`,
      `lastLogtoWipe: ${localStorage.getItem(LOGTO_WIPE_KEY) ?? '-'}`,
      `rehealAttempts: ${sessionStorage.getItem(REHEAL_KEY) ?? '0'}`,
      `lastError: ${errorDetail ?? '-'}`,
    ];
    try {
      localStorage.setItem('munni_probe', '1');
      const ok = localStorage.getItem('munni_probe') === '1';
      localStorage.removeItem('munni_probe');
      lines.push(`lsWrite: ${ok}`);
    } catch (err) {
      const detail = err instanceof Error ? err.name : String(err);
      lines.push(`lsWrite threw: ${detail}`);
    }
    // the definitive probe: can the auth SDK mint a token AT ALL? (the
    // iOS field report showed logtoKeys:0 — evicted client auth storage)
    try {
      const token = await getAccessToken();
      const state = token ? `present (${token.length} chars)` : 'ABSENT';
      lines.push(`accessToken: ${state}`);
    } catch (err) {
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      lines.push(`accessToken threw: ${detail}`);
    }
    try {
      const { apiFetch } = await import('@/lib/api');
      const res = await apiFetch('/me');
      lines.push(`GET /me: ${res.status}`, `www-authenticate: ${res.headers.get('www-authenticate') ?? '-'}`);
    } catch (err) {
      const detail = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
      lines.push(`GET /me threw: ${detail}`);
    }
    setReport(lines.join('\n'));
  };
  return (
    <div className="flex h-full flex-col items-center justify-center gap-3 text-ink-3" data-testid="data-loading">
      {slow && (
        <>
          <Icon name={unreachable ? 'cloud-alert' : 'cloud-sync-outline'} size={32} color="var(--m-ink-4)" />
          <p className="max-w-[280px] text-center text-[13px]" data-testid={unreachable ? 'connect-error' : undefined}>
            {unreachable ? t('sync.serverUnreachable') : t('sync.connecting')}
          </p>
          {unreachable && errorDetail && (
            <p className="max-w-[280px] text-center font-mono text-[10px] break-words text-ink-4" data-testid="connect-error-detail">
              {errorDetail}
            </p>
          )}
          {unreachable && (
            <div className="flex items-center gap-2">
              <button
                onClick={() => void logout()}
                data-testid="connect-signout"
                className="m-tap mt-2 rounded-full border border-line bg-surface px-5 py-2 text-[13px] font-semibold text-ink"
              >
                {t('settings.signOut')}
              </button>
              <button
                onClick={() => void diagnose()}
                data-testid="connect-diagnose"
                className="m-tap mt-2 rounded-full border border-line bg-surface px-5 py-2 text-[13px] font-semibold text-ink"
              >
                {t('sync.diagnose')}
              </button>
            </div>
          )}
          {report && (
            <textarea
              readOnly
              data-testid="connect-diagnose-report"
              value={report}
              rows={8}
              className="mt-2 w-[300px] max-w-[86vw] rounded-input border border-line bg-surface p-2 font-mono text-[10px] text-ink-2"
              onFocus={(e) => e.currentTarget.select()}
            />
          )}
        </>
      )}
    </div>
  );
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error('useData must be used within DataProvider');
  return ctx;
}

/** Demo logout = wipe the database so next login reseeds pristine state. */
/** remote-wipe enforcement: mismatch → wipe this device + back to login */
// remote disconnect (user ruling: disconnect = wipe): the api choke
// point saw a 410 device-revoked — erase this copy exactly like the
// account-binding wipe would. One module-level listener; the identity
// it wipes follows the active DataProvider.
let revokedWipeIdentity: Identity | null = null;

async function wipeRevokedDevice(identity: Identity): Promise<void> {
  const { useSession } = await import('./session');
  useSession.getState().logout();
  await destroyIdentityData(identity);
  globalThis.location.assign('/#/login');
}

function onDeviceRevoked(): void {
  if (revokedWipeIdentity) void wipeRevokedDevice(revokedWipeIdentity).catch(() => undefined);
}

async function enforceAccountBinding(store: StorageBackend, identity: Identity): Promise<void> {
  const { verifyAccountBinding } = await import('@/features/auth/accountBinding');
  await verifyAccountBinding(store, identity, async () => {
    const { useSession } = await import('./session');
    useSession.getState().logout();
    await destroyIdentityData(identity);
    globalThis.location.assign('/#/login');
  });
}

export async function destroyIdentityData(identity: Identity): Promise<void> {
  await destroyStorage(identityDbName(identityKey(identity)));
  // #298: the identity's lock config dies with it — a later signup on
  // this device must never inherit a dead user's PIN
  try {
    localStorage.removeItem(`munni_lock_${identityKey(identity)}`);
  } catch {
    // storage may be unavailable mid-wipe; the stale key is harmless
  }
}
