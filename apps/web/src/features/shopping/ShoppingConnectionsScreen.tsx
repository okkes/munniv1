import { useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useNavigate } from '@tanstack/react-router';
import { LOCALES, useLang } from '@/i18n';
import { useData } from '@/app/data';
import { storesAvailable, useStoreConnMetas, useStoreConnections, useStoreOps } from '@/application/stores';
import type { ConnectResult, ConnectableStore } from '@/application/stores';
import { StoreSyncCard } from './StoreSyncCard';
import type { StoreSyncResult } from '@/features/shopping/stores/sync';
import { AH_AUTHORIZE_URL } from './stores/ah';
import type { StoreConnRow, StoreConnectionRow } from '@/db/types';
import { BrandIconPicker } from '@/features/recurring/BrandIconPicker';
import { DangerConfirmSheet } from '@/ui/DangerConfirmSheet';
import { HelpButton } from '@/features/help/HelpButton';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { FormBlockerNote, blockerRing } from '@/ui/FormBlockerNote';
import { Icon } from '@/ui/Icon';
import { Pill } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';

/** brand names stay brand names — no translation */
const CONNECTABLE = [
  { id: 'ah' as const, name: 'Albert Heijn' },
  { id: 'jumbo' as const, name: 'Jumbo' },
];
const COMING_SOON = [
  { id: 'bol', name: 'bol.com', icon: 'package-variant-closed' },
  { id: 'coolblue', name: 'Coolblue', icon: 'laptop' },
  { id: 'mediamarkt', name: 'MediaMarkt', icon: 'television' },
  { id: 'amazon', name: 'Amazon', icon: 'package-variant-closed' },
] as const;

interface InstanceView {
  meta: StoreConnRow;
  device?: StoreConnectionRow;
}

/** one sync attempt's outcome, spoken out loud (kept from v2) */
function SyncResultLine({ id, state }: Readonly<{ id: string; state: 'busy' | StoreSyncResult }>) {
  const { t } = useLang();
  if (state === 'busy')
    return (
      <span className="block text-[11px] text-ink-4" data-testid={`shop-inst-syncing-${id}`}>
        {t('shop.syncBusy')}
      </span>
    );
  let text = t('shop.syncFailed', { status: state.httpStatus ?? '?' });
  if (state.status === 'ok') text = state.added > 0 ? t('shop.syncAdded', { n: state.added }) : t('shop.syncNone');
  if (state.status === 'expired') text = t('shop.syncExpired');
  // which recipe answered (user question: "is it the fallback?")
  let via = '';
  if (state.status === 'ok' && state.via) via = state.via === 'graphql' ? ' · GraphQL' : ' · REST (fallback)';
  return (
    <span
      className={`block text-[11px] ${state.status === 'ok' ? 'text-accent-deep' : 'text-negative'}`}
      data-testid={`shop-inst-result-${id}`}
    >
      {text}
      {via && <span data-testid="shop-ah-via">{via}</span>}
    </span>
  );
}

/**
 * Settings → Shopping connections, receipts v3: connections are named
 * INSTANCES (several per store), globally visible on the owner's
 * devices, included per space like bank accounts. Connect → name it →
 * manage (rename / icon / spaces / remove) from the instance card.
 */
export function ShoppingConnectionsScreen() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const { store } = useData();
  const metas = useStoreConnMetas();
  const devices = useStoreConnections();
  const ops = useStoreOps();
  const allSpaces = useQuery(store, async () => (await store.allRows('space')).filter((s) => s.deleted === 0), []);
  const links = useQuery(store, async () => (await store.allRows('storeConnLink')).filter((l) => l.deleted === 0), []);

  const [connectStore, setConnectStore] = useState<ConnectableStore | null>(null);
  const [reconnectId, setReconnectId] = useState<string | null>(null);
  const [naming, setNaming] = useState<{ instanceId: string; duplicateOf?: string } | null>(null);
  const [nameDraft, setNameDraft] = useState('');
  // #195: tappable — an invalid tap names the blocker
  const [attempted, setAttempted] = useState(false);
  const [manageId, setManageId] = useState<string | null>(null);
  const [syncStates, setSyncStates] = useState<Record<string, 'busy' | StoreSyncResult>>({});

  const signedIn = storesAvailable();
  const deviceById = new Map((devices ?? []).map((d) => [d.id, d]));
  const instances: InstanceView[] = (metas ?? [])
    .map((meta) => ({ meta, device: deviceById.get(meta.id) }))
    .sort((a, b) => a.meta.displayName.localeCompare(b.meta.displayName));
  const managed = instances.find((i) => i.meta.id === manageId) ?? null;
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' });

  const runSync = async (instanceId: string) => {
    setSyncStates((s) => ({ ...s, [instanceId]: 'busy' }));
    const result = await ops.syncNow(instanceId);
    setSyncStates((s) => ({ ...s, [instanceId]: result }));
  };

  const afterConnect = async (result: ConnectResult) => {
    if (result.outcome !== 'ok' || !result.instanceId) return;
    setConnectStore(null);
    if (reconnectId) {
      setReconnectId(null);
      await runSync(result.instanceId);
      return;
    }
    // fresh instance: ask for a display name right away (user ruling)
    const meta = (await store.allRows('storeConn')).find((c) => c.id === result.instanceId);
    setNameDraft(meta?.displayName ?? '');
    setAttempted(false);
    setNaming({ instanceId: result.instanceId, duplicateOf: result.duplicateOf });
    await runSync(result.instanceId);
  };

  const saveName = async () => {
    if (!naming) return;
    await ops.rename(naming.instanceId, nameDraft);
    setNaming(null);
  };

  const statusLine = (view: InstanceView) => {
    const syncState = syncStates[view.meta.id];
    if (syncState) return <SyncResultLine id={view.meta.id} state={syncState} />;
    if (view.device?.status === 'ok')
      return (
        <span className="block text-[11px] text-ink-4" data-testid={`shop-inst-status-${view.meta.id}`}>
          {t('shop.connectedShort', { date: fmtDate(view.device.refreshedAt) })}
        </span>
      );
    if (view.device?.status === 'expired' || view.meta.status === 'expired')
      return (
        <span className="block text-[11px] text-warning" data-testid={`shop-inst-expired-${view.meta.id}`}>
          {t('shop.expiredNote')}
        </span>
      );
    return (
      <span className="block text-[11px] text-warning" data-testid={`shop-inst-reconnect-note-${view.meta.id}`}>
        {t('shop.reconnectNote')}
      </span>
    );
  };

  const openConnect = (storeId: ConnectableStore, forInstance?: string) => {
    setReconnectId(forInstance ?? null);
    setConnectStore(storeId);
  };

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-shopping">
      <AppBar
        title={t('shop.title')}
        leading={
          <IconButton label={t('action.back')} testId="shopping-back" onClick={() => window.history.back()}>
            <Icon name="arrow-left" size={22} />
          </IconButton>
        }
        trailing={<HelpButton tourId="shopping" />}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <div className="flex items-start gap-3 rounded-card border border-line bg-surface px-4 py-3" data-testid="shopping-privacy">
          <Icon name="shield-lock-outline" size={18} color="var(--m-accent-deep)" />
          <p className="min-w-0 flex-1 text-[12px] leading-relaxed text-ink-2">{t('shop.privacy')}</p>
        </div>

        {!signedIn && (
          <p className="mt-2 px-1 text-[12px] text-ink-4" data-testid="shopping-signin-note">
            {t('shop.signInNote')}
          </p>
        )}

        {/* connected instances — several per store are fine (user ruling) */}
        {instances.length > 0 && (
          <>
            <div className="m-cap mt-4 mb-1 px-1">{t('shop.instances')}</div>
            <div className="overflow-hidden rounded-card border border-line bg-surface">
              {instances.map((view) => (
                <div
                  key={view.meta.id}
                  className="flex items-center gap-3 border-b border-line-2 px-4 py-3.5 last:border-0"
                  data-testid={`shop-inst-${view.meta.id}`}
                >
                  {view.meta.icon ? (
                    <img src={view.meta.icon} alt="" className="h-6 w-6 rounded object-contain" />
                  ) : (
                    <Icon name="cart-outline" size={20} color={view.device?.status === 'ok' ? 'var(--m-accent-deep)' : 'var(--m-ink-3)'} />
                  )}
                  <span className="min-w-0 flex-1">
                    <span className="flex items-center gap-1.5">
                      <span className="truncate text-[15px] text-ink">{view.meta.displayName}</span>
                      {view.device?.status === 'ok' && <Icon name="check-circle" size={14} color="var(--m-accent-deep)" />}
                    </span>
                    {statusLine(view)}
                  </span>
                  {signedIn && view.device?.status === 'ok' && (
                    <button
                      data-testid={`shop-inst-sync-${view.meta.id}`}
                      onClick={() => void runSync(view.meta.id)}
                      className="m-tap border-none bg-transparent text-[12px] font-medium text-accent-deep"
                    >
                      {t('shop.syncNow')}
                    </button>
                  )}
                  {signedIn && !view.device && (
                    <Button size="sm" variant="outline" data-testid={`shop-inst-reconnect-${view.meta.id}`} onClick={() => openConnect(view.meta.store as ConnectableStore, view.meta.id)}>
                      {t('shop.reconnect')}
                    </Button>
                  )}
                  {signedIn && view.device?.status === 'expired' && (
                    <Button size="sm" variant="outline" data-testid={`shop-inst-reconnect-${view.meta.id}`} onClick={() => openConnect(view.meta.store as ConnectableStore, view.meta.id)}>
                      {t('shop.reconnect')}
                    </Button>
                  )}
                  <button
                    data-testid={`shop-inst-manage-${view.meta.id}`}
                    aria-label={t('shop.manage')}
                    onClick={() => setManageId(view.meta.id)}
                    className="m-tap border-none bg-transparent text-ink-4"
                  >
                    <Icon name="dots-horizontal" size={18} />
                  </button>
                </div>
              ))}
            </div>
          </>
        )}

        {/* add a connection — always available, duplicates get a warning */}
        <div className="m-cap mt-4 mb-1 px-1">{t('shop.addConnection')}</div>
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          {CONNECTABLE.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 border-b border-line-2 px-4 py-3.5" data-testid={`shopping-store-${entry.id}`}>
              <Icon name="cart-outline" size={20} color="var(--m-ink-3)" />
              <span className="min-w-0 flex-1 text-[15px] text-ink">{entry.name}</span>
              {signedIn ? (
                <Button size="sm" data-testid={`shop-${entry.id}-connect`} onClick={() => openConnect(entry.id)}>
                  {t('shop.connect')}
                </Button>
              ) : (
                <span className="rounded-full bg-bg-2 px-2 py-0.5 text-[11px] font-medium text-ink-4">{t('shop.signInShort')}</span>
              )}
            </div>
          ))}
          {COMING_SOON.map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 border-b border-line-2 px-4 py-3.5 last:border-0" data-testid={`shopping-store-${entry.id}`}>
              <Icon name={entry.icon} size={20} color="var(--m-ink-3)" />
              <span className="min-w-0 flex-1 text-[15px] text-ink">{entry.name}</span>
              <Pill>{t('shop.comingSoon')}</Pill>
            </div>
          ))}
        </div>

        {/* the browsing door: every receipt, photos included */}
        <button
          data-testid="shop-view-receipts"
          onClick={() => void navigate({ to: '/receipts' })}
          className="m-tap mt-3 flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3.5 text-left"
        >
          <Icon name="receipt-text-outline" size={20} color="var(--m-ink-2)" />
          <span className="min-w-0 flex-1 text-[15px] text-ink">{t('receipts.title')}</span>
          <Icon name="chevron-right" size={18} color="var(--m-ink-4)" />
        </button>

        <p className="mt-3 px-1 text-[12px] text-ink-4" data-testid="shopping-photo-note">
          {t('shop.photoNote')}
        </p>
        {signedIn && <StoreSyncCard />}
      </div>

      <ConnectAhSheet
        open={connectStore === 'ah'}
        onOpenChange={(open) => !open && setConnectStore(null)}
        reconnectId={reconnectId}
        onDone={afterConnect}
      />
      <ConnectJumboSheet
        open={connectStore === 'jumbo'}
        onOpenChange={(open) => !open && setConnectStore(null)}
        reconnectId={reconnectId}
        onDone={afterConnect}
      />

      {/* name-the-instance step right after a successful connect */}
      <Sheet
        open={naming !== null}
        onOpenChange={(open) => {
          if (open) return;
          setNaming(null);
          setAttempted(false);
        }}
        title={t('shop.nameTitle')}
        size="form"
      >
        <div className="flex flex-col gap-3 pt-1">
          <p className="text-[13px] leading-relaxed text-ink-2">{t('shop.nameHint')}</p>
          {naming?.duplicateOf && (
            <p className="rounded-card bg-warning-soft px-3 py-2 text-[12px] leading-relaxed text-ink-2" data-testid="shop-dup-note">
              {t('shop.duplicateNote')}
            </p>
          )}
          <input
            data-testid="shop-name-input"
            value={nameDraft}
            onChange={(e) => setNameDraft(e.target.value)}
            aria-invalid={attempted && !nameDraft.trim()}
            className={`h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none${blockerRing(attempted && !nameDraft.trim())}`}
          />
          <FormBlockerNote show={attempted && !nameDraft.trim()} text={t('form.needName')} testId="shop-name-save-blocker" />
          <Button
            data-testid="shop-name-save"
            onClick={() => {
              if (!nameDraft.trim()) {
                setAttempted(true);
                return;
              }
              void saveName();
            }}
          >
            {t('action.save')}
          </Button>
        </div>
      </Sheet>

      {managed && (
        <ManageInstanceSheet
          view={managed}
          allSpaces={allSpaces ?? []}
          includedSpaceIds={(links ?? []).filter((l) => l.instanceId === managed.meta.id).map((l) => l.spaceId)}
          onClose={() => setManageId(null)}
        />
      )}
    </div>
  );
}

function ConnectAhSheet({
  open,
  onOpenChange,
  reconnectId,
  onDone,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reconnectId: string | null;
  onDone: (result: ConnectResult) => Promise<void>;
}>) {
  const { t } = useLang();
  const ops = useStoreOps();
  const [pasted, setPasted] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  const submit = async () => {
    setBusy(true);
    setFailed(false);
    try {
      const result = await ops.connectAh(pasted, reconnectId ?? undefined);
      if (result.outcome !== 'ok') {
        setFailed(true);
        return;
      }
      setPasted('');
      await onDone(result);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('shop.connectTitle')} size="tall">
      <div className="flex flex-col gap-3 pt-1">
        <p className="text-[13px] leading-relaxed text-ink-2">{t('shop.connectStep1')}</p>
        <a
          data-testid="shop-ah-open-login"
          href={AH_AUTHORIZE_URL}
          target="_blank"
          rel="noreferrer"
          className="m-tap flex items-center justify-center gap-2 rounded-input border border-line bg-surface px-4 py-3 text-[14px] font-medium text-accent-deep no-underline"
        >
          <Icon name="open-in-new" size={16} />
          {t('shop.openLogin')}
        </a>
        <p className="text-[13px] leading-relaxed text-ink-2">{t('shop.connectStep2')}</p>
        {/* the appie:// landing is a custom-scheme link: a phone WITH the
            AH app installed hands it straight to that app, so the address
            is never visible to copy (user report) — say so up front */}
        <p className="rounded-card bg-bg-2 px-3 py-2 text-[12px] leading-relaxed text-ink-3" data-testid="shop-ah-app-note">
          {t('shop.connectAppNote')}
        </p>
        <input
          data-testid="shop-ah-paste"
          value={pasted}
          onChange={(e) => setPasted(e.target.value)}
          placeholder="appie://login-exit?code=…"
          className="h-12 w-full rounded-input border border-line bg-surface px-4 font-mono text-[13px] text-ink outline-none placeholder:text-ink-4"
        />
        {/* pasted blobs overflow the input silently — echo a glanceable tail (§2L) */}
        {pasted.trim() && (
          <p className="truncate px-1 font-mono text-[11px] text-ink-4" data-testid="shop-ah-preview">
            {pasted.trim()}
          </p>
        )}
        {failed && (
          <p className="text-[12px] text-negative" data-testid="shop-ah-failed">
            {t('shop.connectFailed')}
          </p>
        )}
        <Button data-testid="shop-ah-submit" disabled={busy || !pasted.trim()} onClick={() => void submit()}>
          {t('shop.connect')}
        </Button>
      </div>
    </Sheet>
  );
}

function ConnectJumboSheet({
  open,
  onOpenChange,
  reconnectId,
  onDone,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  reconnectId: string | null;
  onDone: (result: ConnectResult) => Promise<void>;
}>) {
  const { t } = useLang();
  const ops = useStoreOps();
  const [user, setUser] = useState('');
  const [pass, setPass] = useState('');
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState<'blocked' | 'failed' | null>(null);

  const submit = async () => {
    setBusy(true);
    setFailed(null);
    try {
      const result = await ops.connectJumbo(user.trim(), pass, reconnectId ?? undefined);
      if (result.outcome !== 'ok') {
        setFailed(result.outcome);
        return;
      }
      setUser('');
      setPass(''); // never keep the password around
      await onDone(result);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={t('shop.connectJumboTitle')} size="form">
      <div className="flex flex-col gap-3 pt-1">
        <p className="text-[13px] leading-relaxed text-ink-2">{t('shop.jumboNote')}</p>
        <input
          data-testid="shop-jumbo-user"
          value={user}
          onChange={(e) => setUser(e.target.value)}
          autoComplete="off"
          inputMode="email"
          placeholder={t('shop.jumboUser')}
          className="h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4"
        />
        <input
          data-testid="shop-jumbo-pass"
          type="password"
          value={pass}
          onChange={(e) => setPass(e.target.value)}
          autoComplete="off"
          placeholder={t('shop.jumboPass')}
          className="h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4"
        />
        {failed && (
          <p className="text-[12px] text-negative" data-testid="shop-jumbo-failed">
            {t(failed === 'blocked' ? 'shop.jumboBlocked' : 'shop.jumboLoginFailed')}
          </p>
        )}
        <Button data-testid="shop-jumbo-submit" disabled={busy || !user.trim() || !pass} onClick={() => void submit()}>
          {t('shop.connect')}
        </Button>
      </div>
    </Sheet>
  );
}

/** rename / icon / included spaces / remove for one instance */
function ManageInstanceSheet({
  view,
  allSpaces,
  includedSpaceIds,
  onClose,
}: Readonly<{
  view: InstanceView;
  allSpaces: readonly { id: string; name: string }[];
  includedSpaceIds: readonly string[];
  onClose: () => void;
}>) {
  const { t } = useLang();
  const ops = useStoreOps();
  const [name, setName] = useState(view.meta.displayName);
  const [iconOpen, setIconOpen] = useState(false);
  const [confirmRemove, setConfirmRemove] = useState(false);
  const [busy, setBusy] = useState(false);

  const toggleSpace = async (spaceId: string) => {
    if (busy) return;
    setBusy(true);
    try {
      const next = includedSpaceIds.includes(spaceId)
        ? includedSpaceIds.filter((id) => id !== spaceId)
        : [...includedSpaceIds, spaceId];
      await ops.setIncludedSpaces(view.meta.id, next);
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    await ops.removeInstance(view.meta.id);
    onClose();
  };

  return (
    <Sheet open onOpenChange={(open) => !open && onClose()} title={view.meta.displayName} size="tall">
      <div className="flex flex-col gap-3 pt-1">
        <label className="flex items-center gap-3 text-[13px] text-ink-2">
          {t('acct.displayName')}
          <input
            data-testid="shop-manage-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onBlur={() => name.trim() && name.trim() !== view.meta.displayName && void ops.rename(view.meta.id, name)}
            className="h-10 min-w-0 flex-1 rounded-input border border-line bg-surface px-3 text-[13px] text-ink outline-none"
          />
        </label>
        <button
          data-testid="shop-manage-icon"
          onClick={() => setIconOpen(true)}
          className="m-tap flex w-full items-center gap-3 rounded-input border border-line bg-surface px-3 py-2.5 text-left text-[13px] text-ink"
        >
          {view.meta.icon ? (
            <img src={view.meta.icon} alt="" className="h-6 w-6 rounded object-contain" />
          ) : (
            <Icon name="cart-outline" size={20} color="var(--m-ink-3)" />
          )}
          <span className="flex-1">{t('acct.changeIcon')}</span>
          <Icon name="chevron-right" size={16} color="var(--m-ink-4)" />
        </button>

        {/* which spaces this connection's receipts flow into */}
        <div className="m-cap px-1">{t('shop.sharedSpaces')}</div>
        <p className="px-1 text-[11px] leading-snug text-ink-4">{t('shop.sharedSpacesSub')}</p>
        <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="shop-manage-spaces">
          {allSpaces.map((entry) => {
            const included = includedSpaceIds.includes(entry.id);
            return (
              <button
                key={entry.id}
                data-testid={`shop-inst-space-${entry.id}`}
                disabled={busy}
                onClick={() => void toggleSpace(entry.id)}
                className="m-tap flex w-full items-center gap-3 border-b border-line-2 bg-transparent px-4 py-3 text-left last:border-0"
              >
                <Icon
                  name={included ? 'checkbox-marked' : 'checkbox-blank-outline'}
                  size={20}
                  color={included ? 'var(--m-accent)' : 'var(--m-ink-4)'}
                />
                <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{entry.name}</span>
              </button>
            );
          })}
        </div>

        <Button variant="danger" data-testid="shop-inst-remove" onClick={() => setConfirmRemove(true)}>
          {t('shop.removeInstance')}
        </Button>
      </div>
      {/* aligned destructive confirm (user request): sheet + cooldown */}
      <DangerConfirmSheet
        open={confirmRemove}
        onOpenChange={setConfirmRemove}
        title={t('shop.removeInstance')}
        body={t('shop.removeNote')}
        onConfirm={() => void remove()}
        testId="shop-inst-remove"
      />
      <BrandIconPicker
        open={iconOpen}
        onOpenChange={setIconOpen}
        initialQuery={view.meta.displayName}
        onPick={({ logo }) => {
          void ops.setIcon(view.meta.id, logo);
          setIconOpen(false);
        }}
      />
    </Sheet>
  );
}
