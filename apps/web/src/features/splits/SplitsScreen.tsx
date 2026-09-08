import { useCallback, useEffect, useMemo, useState } from 'react';
import { publicOrigin } from '@/app/config';
import { useNavigate, useParams } from '@tanstack/react-router';
import { v7 as uuidv7 } from 'uuid';
import { useLang, LOCALES } from '@/i18n';
import { useData } from '@/app/data';
import { useSession } from '@/app/session';
import { apiFetch } from '@/lib/api';
import { fmtCents, parseCents } from '@/lib/money';
import { netPositions, settlementPlan } from '@/domain/splitLedger';
import type { LedgerEntry } from '@/domain/splitLedger';
import type { TransactionRow } from '@/db/types';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { SearchField } from '@/ui/SearchField';

interface SplitSummary {
  id: string;
  name: string;
  currency: string;
  status: string;
  role: string;
  memberCount: number;
  entryCount: number;
}
interface SplitMember {
  userId: string;
  role: string;
  displayName: string | null;
  isMe: boolean;
}
interface SplitEntryRow {
  id: string;
  kind: string;
  paidByUserId: string;
  description: string;
  amountCents: number;
  date: string;
  shares: { userId: string; cents: number }[];
  /** the adder's private backlink — the server serializes it only for them */
  sourceTxId?: string | null;
  createdBy: string;
}
interface SplitDetail {
  id: string;
  name: string;
  currency: string;
  status: string;
  role: string;
  attachedSpaceId?: string | null;
  attachedEventId?: string | null;
  members: SplitMember[];
  entries: SplitEntryRow[];
}

const memberName = (member: SplitMember | undefined, meLabel: string) =>
  member?.isMe ? meLabel : (member?.displayName ?? '…');

const netTone = (net: number): string => {
  if (net > 0) return 'text-accent-deep';
  if (net < 0) return 'text-negative';
  return 'text-ink-3';
};

/**
 * Split sessions (settleup-splits SP1): Splitwise-style group ledgers
 * whose membership is independent of spaces — server-resident and
 * online-only, so only signed-in identities see the feature.
 */
export function SplitsScreen() {
  const { t } = useLang();
  const navigate = useNavigate();
  const { spaceId } = useData();
  const [splits, setSplits] = useState<SplitSummary[] | null>(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [name, setName] = useState('');
  const [busy, setBusy] = useState(false);
  const [offline, setOffline] = useState(false);

  const reload = useCallback(async () => {
    const res = await apiFetch('/splits').catch(() => null);
    if (res?.ok) {
      setSplits((await res.json()) as SplitSummary[]);
      setOffline(false);
    } else {
      setOffline(true);
      setSplits((prev) => prev ?? []);
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const create = async () => {
    if (!name.trim()) return;
    setBusy(true);
    const id = uuidv7();
    const res = await apiFetch('/splits', {
      method: 'POST',
      body: JSON.stringify({ id, name: name.trim(), currency: 'EUR', spaceId }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) {
      setOffline(true);
      return;
    }
    setCreateOpen(false);
    setName('');
    await navigate({ to: '/splits/$splitId', params: { splitId: id } });
  };

  return (
    <div className="flex h-dvh flex-col bg-bg" data-testid="screen-splits">
      <AppBar
        title={t('splits.title')}
        leading={
          <IconButton label={t('action.back')} testId="splits-back" onClick={() => window.history.back()}>
            <Icon name="chevron-left" size={24} />
          </IconButton>
        }
        trailing={
          <IconButton label={t('splits.new')} testId="splits-add" onClick={() => setCreateOpen(true)}>
            <Icon name="plus" size={22} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {offline && (
          <p className="py-2 text-center text-[12px] text-ink-4" data-testid="splits-offline">
            {t('splits.offline')}
          </p>
        )}
        {splits !== null && splits.length === 0 && !offline && (
          <div className="pt-16 text-center" data-testid="splits-empty">
            <Icon name="account-cash-outline" size={40} color="var(--m-ink-4)" />
            <p className="mt-3 text-[15px] font-medium text-ink">{t('splits.emptyTitle')}</p>
            <p className="mx-auto mt-1 max-w-[280px] text-[13px] text-ink-3">{t('splits.emptyBody')}</p>
          </div>
        )}
        <div className="overflow-hidden rounded-card border border-line bg-surface">
          {(splits ?? []).map((split) => (
            <button
              key={split.id}
              data-testid={`split-row-${split.id}`}
              onClick={() => void navigate({ to: '/splits/$splitId', params: { splitId: split.id } })}
              className="m-tap flex w-full items-center gap-3 border-b border-line-2 bg-transparent px-4 py-3.5 text-left last:border-0"
            >
              <Icon name="account-cash-outline" size={20} color="var(--m-accent-deep)" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[15px] text-ink">{split.name}</span>
                <span className="block text-[11px] text-ink-4">
                  {split.memberCount === 1 ? t('splits.membersCountOne') : t('splits.membersCount', { n: split.memberCount })}
                  {' · '}
                  {split.entryCount === 1 ? t('splits.entriesCountOne') : t('splits.entriesCount', { n: split.entryCount })}
                </span>
              </span>
              {split.status === 'settled' && <span className="text-[11px] text-ink-4">{t('splits.settled')}</span>}
              <Icon name="chevron-right" size={18} color="var(--m-ink-4)" />
            </button>
          ))}
          {splits === null && <div className="px-4 py-6 text-center text-[13px] text-ink-4">…</div>}
        </div>
      </div>

      <Sheet open={createOpen} onOpenChange={setCreateOpen} title={t('splits.new')} size="form">
        <div className="flex flex-col gap-3 pt-1">
          <input
            data-testid="split-name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder={t('splits.namePlaceholder')}
            className="h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none"
          />
          <p className="text-[12px] text-ink-4">{t('splits.createHint')}</p>
          <Button data-testid="split-create" disabled={busy || !name.trim()} onClick={() => void create()}>
            {t('action.create')}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}

export function SplitDetailScreen() {
  const { t, lang } = useLang();
  const { splitId } = useParams({ strict: false }) as { splitId: string };
  const { identity } = useSession();
  const { store, repo, spaceId } = useData();
  const [detail, setDetail] = useState<SplitDetail | null>(null);
  const [addOpen, setAddOpen] = useState(false);
  const [description, setDescription] = useState('');
  const [amount, setAmount] = useState('');
  const [paidBy, setPaidBy] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // SP2: pick expenses from MY attached space's transactions (local db —
  // other members' searches never see them) + optional custom shares
  const [txOpen, setTxOpen] = useState(false);
  const [txQuery, setTxQuery] = useState('');
  const [txResults, setTxResults] = useState<TransactionRow[] | null>(null);
  const [txSelected, setTxSelected] = useState<ReadonlySet<string>>(new Set());
  const [sharesOpen, setSharesOpen] = useState(false);
  const [shareInputs, setShareInputs] = useState<Record<string, string>>({});
  // SP3: share-link invites — anyone with the link joins, no friendship
  // needed, and joining grants ZERO space access (server-enforced)
  const [inviteOpen, setInviteOpen] = useState(false);
  const [inviteLink, setInviteLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  // SP4: members settle their own debts; only the owner closes (Q3)
  const [closeOpen, setCloseOpen] = useState(false);
  // SP5: MY event link (per-member, private) + auto-attach of searched txs
  const [eventOpen, setEventOpen] = useState(false);
  const [myEvents, setMyEvents] = useState<{ id: string; name: string }[] | null>(null);

  const reload = useCallback(async () => {
    const res = await apiFetch(`/splits/${splitId}`).catch(() => null);
    if (res?.ok) setDetail((await res.json()) as SplitDetail);
  }, [splitId]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const me = detail?.members.find((m) => m.isMe);
  const nameOf = useCallback(
    (userId: string) => memberName(detail?.members.find((m) => m.userId === userId), t('word.you')),
    [detail, t],
  );

  // search MY attached space only (per-member attachment ruling); the
  // creator's attachment may be unset for pre-SP2 splits — active space then
  const searchSpaceId = detail?.attachedSpaceId ?? spaceId;
  const alreadyAdded = useMemo(
    () => new Set((detail?.entries ?? []).map((e) => e.sourceTxId).filter(Boolean) as string[]),
    [detail],
  );

  useEffect(() => {
    if (!txOpen) return;
    let stale = false;
    void (async () => {
      const all = await store.bySpace('transaction', searchSpaceId);
      const needle = txQuery.trim().toLowerCase();
      const matches = all
        .filter((tx) => tx.deleted === 0 && tx.amountCents < 0 && !alreadyAdded.has(tx.id))
        .filter(
          (tx) =>
            !needle ||
            tx.merchant.toLowerCase().includes(needle) ||
            (tx.description ?? '').toLowerCase().includes(needle) ||
            String(Math.abs(tx.amountCents) / 100).includes(needle.replace(',', '.')),
        )
        .sort((a, b) => b.date.localeCompare(a.date))
        .slice(0, 50);
      if (!stale) setTxResults(matches);
    })();
    return () => {
      stale = true;
    };
  }, [txOpen, txQuery, store, searchSpaceId, alreadyAdded]);

  const toggleTx = (id: string) => {
    setTxSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  // snapshot copy (design: the split never holds a live reference — later
  // edits to the source tx don't rewrite the group's agreed history)
  const addFromTx = async () => {
    if (!detail || !me || txSelected.size === 0) return;
    setBusy(true);
    const picked = (txResults ?? []).filter((tx) => txSelected.has(tx.id));
    for (const tx of picked) {
      await apiFetch(`/splits/${splitId}/entries`, {
        method: 'POST',
        body: JSON.stringify({
          id: uuidv7(),
          kind: 'expense',
          paidByUserId: me.userId,
          description: tx.merchant,
          amountCents: -tx.amountCents,
          date: tx.date,
          sourceTxId: tx.id,
        }),
      }).catch(() => null);
    }
    setBusy(false);
    setTxOpen(false);
    setTxSelected(new Set());
    setTxQuery('');
    // my event link applies to what I just added (design: auto-attach)
    if (detail.attachedEventId) await autoAttachToEvent(detail.attachedEventId, picked.map((tx) => tx.id));
    await reload();
  };

  // SP5: expenses I picked from search follow MY event link automatically —
  // retroactively when I link, and for every later addition
  const autoAttachToEvent = async (eventId: string, txIds: (string | null | undefined)[]) => {
    for (const txId of txIds) {
      if (!txId) continue;
      const tx = await store.get('transaction', txId);
      if (tx?.deleted === 0 && !tx.eventId) {
        await repo.upsert('transaction', tx.spaceId, txId, { eventId });
      }
    }
  };

  const linkEvent = async (eventId: string | null) => {
    setBusy(true);
    const res = await apiFetch(`/splits/${splitId}/attach`, {
      method: 'POST',
      body: JSON.stringify({ eventId }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return;
    setEventOpen(false);
    // the server only ever serialized MY backlinks — exactly the set to attach
    if (eventId) await autoAttachToEvent(eventId, (detail?.entries ?? []).map((e) => e.sourceTxId));
    await reload();
  };

  useEffect(() => {
    if (!eventOpen) return;
    void (async () => {
      const rows = await store.bySpace('event', searchSpaceId);
      setMyEvents(rows.filter((e) => e.deleted === 0).map((e) => ({ id: e.id, name: e.name })));
    })();
  }, [eventOpen, store, searchSpaceId]);

  const [linkedEventName, setLinkedEventName] = useState<string | null>(null);
  useEffect(() => {
    const id = detail?.attachedEventId;
    if (!id) {
      setLinkedEventName(null);
      return;
    }
    void store.get('event', id).then((event) => setLinkedEventName(event?.name ?? null));
  }, [detail, store]);

  // a settlement is just an entry whose only share holder is the receiver
  // (the ledger math needs no special case — design ruling)
  const settleUp = async (toUserId: string, cents: number) => {
    if (!me || busy) return;
    setBusy(true);
    await apiFetch(`/splits/${splitId}/entries`, {
      method: 'POST',
      body: JSON.stringify({
        id: uuidv7(),
        kind: 'settlement',
        paidByUserId: me.userId,
        description: 'Settlement',
        amountCents: cents,
        date: new Date().toISOString().slice(0, 10),
        shares: [{ userId: toUserId, cents }],
      }),
    }).catch(() => null);
    setBusy(false);
    await reload();
  };

  const closeSplit = async () => {
    setBusy(true);
    const res = await apiFetch(`/splits/${splitId}/close`, { method: 'POST' }).catch(() => null);
    setBusy(false);
    if (res?.ok) {
      setCloseOpen(false);
      await reload();
    }
  };

  const entryLabel = (entry: SplitEntryRow) =>
    entry.kind === 'settlement'
      ? t('splits.settlementLabel', {
          from: nameOf(entry.paidByUserId),
          to: nameOf(entry.shares[0]?.userId ?? ''),
        })
      : entry.description;

  const openInvite = async () => {
    setInviteOpen(true);
    setCopied(false);
    if (inviteLink) return; // one active link per split — reuse this session's
    const res = await apiFetch(`/splits/${splitId}/invites`, { method: 'POST' }).catch(() => null);
    if (!res?.ok) return;
    const { token } = (await res.json()) as { token: string };
    // the hosted https origin, never capacitor://localhost — the link
    // must open for people on any platform (user report)
    const base = `${publicOrigin()}/`;
    // real path (no #): verified app links open the app directly; the
    // web shell bounces it into the hash router
    setInviteLink(`${base}splits/join/${token}`);
  };

  const shareInvite = async () => {
    if (!inviteLink || !detail) return;
    if (navigator.share) {
      await navigator.share({ title: detail.name, url: inviteLink }).catch(() => undefined);
      return;
    }
    await navigator.clipboard?.writeText(inviteLink).catch(() => undefined);
    setCopied(true);
  };

  // custom shares: blank input = 0; the sum must match the amount exactly
  const shareCents = (userId: string) => parseCents(shareInputs[userId] ?? '') ?? 0;
  const sharesSum = (detail?.members ?? []).reduce((sum, m) => sum + shareCents(m.userId), 0);
  const sharesRemaining = (parseCents(amount) ?? 0) - sharesSum;

  const ledger = useMemo(() => {
    if (!detail) return null;
    const entries: LedgerEntry[] = detail.entries.map((e) => ({
      paidByUserId: e.paidByUserId,
      amountCents: e.amountCents,
      shares: e.shares.map((s) => ({ userId: s.userId, cents: s.cents })),
    }));
    const nets = netPositions(entries, detail.members.map((m) => m.userId));
    return { nets, plan: settlementPlan(nets) };
  }, [detail]);

  const addEntry = async () => {
    const cents = parseCents(amount) ?? 0;
    if (!description.trim() || cents <= 0 || !detail) return;
    if (sharesOpen && sharesRemaining !== 0) return;
    setBusy(true);
    const res = await apiFetch(`/splits/${splitId}/entries`, {
      method: 'POST',
      body: JSON.stringify({
        id: uuidv7(),
        kind: 'expense',
        paidByUserId: paidBy ?? me?.userId,
        description: description.trim(),
        amountCents: cents,
        date: new Date().toISOString().slice(0, 10),
        shares: sharesOpen
          ? detail.members.map((m) => ({ userId: m.userId, cents: shareCents(m.userId) }))
          : undefined,
      }),
    }).catch(() => null);
    setBusy(false);
    if (!res?.ok) return;
    setAddOpen(false);
    setDescription('');
    setAmount('');
    setPaidBy(null);
    setSharesOpen(false);
    setShareInputs({});
    await reload();
  };

  if (identity?.kind !== 'user') return null;

  return (
    <div className="flex h-dvh flex-col bg-bg" data-testid="screen-split-detail">
      <AppBar
        title={detail?.name ?? '…'}
        leading={
          <IconButton label={t('action.back')} testId="split-back" onClick={() => window.history.back()}>
            <Icon name="chevron-left" size={24} />
          </IconButton>
        }
        trailing={
          detail?.status === 'open' ? (
            <IconButton label={t('splits.addEntry')} testId="split-add-entry" onClick={() => setAddOpen(true)}>
              <Icon name="plus" size={22} />
            </IconButton>
          ) : undefined
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {/* who owes whom — the whole point, so it leads */}
        {ledger && detail && detail.entries.length > 0 && (
          <>
            <div className="m-cap mt-2 mb-1 px-1">{t('splits.balances')}</div>
            <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="split-ledger">
              {detail.members.map((member) => {
                const net = ledger.nets.get(member.userId) ?? 0;
                return (
                  <div key={member.userId} className="flex items-center gap-3 border-b border-line-2 px-4 py-2.5 last:border-0">
                    <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{memberName(member, t('word.you'))}</span>
                    <span className={`m-num text-[14px] font-semibold ${netTone(net)}`}>
                      {fmtCents(net, detail.currency, lang, { sign: true })}
                    </span>
                  </div>
                );
              })}
              {ledger.plan.length > 0 && <div className="mx-4 h-px bg-line-2" />}
              {ledger.plan.map((transfer) => (
                <div
                  key={`${transfer.fromUserId}-${transfer.toUserId}`}
                  data-testid="split-transfer"
                  className="flex items-center gap-2 px-4 py-2.5 text-[13px] text-ink-2"
                >
                  <Icon name="arrow-right-thin" size={16} color="var(--m-ink-4)" />
                  <span className="min-w-0 flex-1">
                    {t('splits.owes', {
                      from: nameOf(transfer.fromUserId),
                      to: nameOf(transfer.toUserId),
                      amount: fmtCents(transfer.cents, detail.currency, lang),
                    })}
                  </span>
                  {detail.status === 'open' && transfer.fromUserId === me?.userId && (
                    <button
                      data-testid="split-settle"
                      disabled={busy}
                      onClick={() => void settleUp(transfer.toUserId, transfer.cents)}
                      className="m-tap rounded-full border border-accent bg-accent-soft px-3 py-1 text-[12px] font-semibold text-accent-deep"
                    >
                      {t('splits.settle')}
                    </button>
                  )}
                </div>
              ))}
            </div>
          </>
        )}

        <div className="m-cap mt-5 mb-1 px-1">{t('splits.entries')}</div>
        <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="split-entries">
          {(detail?.entries ?? []).map((entry) => (
            <div key={entry.id} className="flex items-center gap-3 border-b border-line-2 px-4 py-3 last:border-0">
              <span className="min-w-0 flex-1">
                <span className="flex items-center gap-1.5 text-[14px] text-ink">
                  {entry.kind === 'settlement' && <Icon name="handshake-outline" size={14} color="var(--m-accent-deep)" />}
                  <span className="truncate">{entryLabel(entry)}</span>
                  {entry.sourceTxId && (
                    <span data-testid="split-entry-linked" className="inline-flex">
                      <Icon name="bank-outline" size={13} color="var(--m-ink-4)" />
                    </span>
                  )}
                </span>
                <span className="block text-[11px] text-ink-4">
                  {new Date(entry.date).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' })} ·{' '}
                  {t('splits.paidBy', { name: nameOf(entry.paidByUserId) })}
                </span>
              </span>
              <span className="m-num text-[14px] font-semibold text-ink">
                {fmtCents(entry.amountCents, detail?.currency ?? 'EUR', lang)}
              </span>
            </div>
          ))}
          {detail !== null && detail.entries.length === 0 && (
            <div className="px-4 py-6 text-center text-[13px] text-ink-4">{t('splits.noEntries')}</div>
          )}
          {detail === null && <div className="px-4 py-6 text-center text-[13px] text-ink-4">…</div>}
        </div>

        <div className="m-cap mt-5 mb-1 px-1">{t('space.members')}</div>
        <div className="overflow-hidden rounded-card border border-line bg-surface" data-testid="split-members">
          {(detail?.members ?? []).map((member) => (
            <div key={member.userId} className="flex items-center gap-3 border-b border-line-2 px-4 py-2.5 last:border-0">
              <Icon name="account-outline" size={18} color="var(--m-ink-3)" />
              <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{memberName(member, t('word.you'))}</span>
              {member.role === 'owner' && <span className="text-[11px] text-ink-4">{t('space.permOwner')}</span>}
            </div>
          ))}
          {detail?.status === 'open' && (
            <button
              data-testid="split-invite"
              onClick={() => void openInvite()}
              className="m-tap flex w-full items-center gap-3 border-t border-line-2 bg-transparent px-4 py-2.5 text-left"
            >
              <Icon name="account-plus-outline" size={18} color="var(--m-accent-deep)" />
              <span className="min-w-0 flex-1 truncate text-[14px] font-medium text-accent-deep">{t('splits.inviteRow')}</span>
            </button>
          )}
        </div>

        {/* SP5: MY event link — private wiring, others never see it */}
        {detail && (
          <>
            <div className="m-cap mt-5 mb-1 px-1">{t('splits.eventCap')}</div>
            <button
              data-testid="split-event-row"
              onClick={() => setEventOpen(true)}
              disabled={detail.status !== 'open' && !detail.attachedEventId}
              className="m-tap flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left"
            >
              <Icon name="calendar-star" size={20} color="var(--m-accent-deep)" />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] text-ink">
                  {linkedEventName ?? t('splits.eventNone')}
                </span>
                <span className="block text-[11px] text-ink-4">{t('splits.eventSub')}</span>
              </span>
              <Icon name="chevron-right" size={18} color="var(--m-ink-4)" />
            </button>
          </>
        )}

        {detail?.status === 'settled' && (
          <p className="mt-4 text-center text-[12px] text-ink-4" data-testid="split-closed-note">
            {t('splits.closedNote')}
          </p>
        )}
        {detail?.status === 'open' && detail.role === 'owner' && (
          <button
            data-testid="split-close"
            onClick={() => setCloseOpen(true)}
            className="m-tap mt-6 w-full rounded-card border border-line bg-surface px-4 py-3 text-center text-[14px] font-medium text-ink-2"
          >
            {t('splits.close')}
          </button>
        )}
      </div>

      <Sheet open={closeOpen} onOpenChange={setCloseOpen} title={t('splits.close')} size="compact">
        <div className="flex flex-col gap-3 pt-1">
          <p className="text-[13px] text-ink-2">{t('splits.closeHint')}</p>
          <Button data-testid="split-close-confirm" disabled={busy} onClick={() => void closeSplit()}>
            {t('splits.close')}
          </Button>
        </div>
      </Sheet>

      <Sheet open={eventOpen} onOpenChange={setEventOpen} title={t('splits.eventCap')} size="form">
        <div className="flex flex-col gap-3 pt-1">
          <p className="text-[13px] text-ink-2">{t('splits.eventHint')}</p>
          <div className="overflow-hidden rounded-card border border-line bg-surface">
            {(myEvents ?? []).map((event) => (
              <button
                key={event.id}
                data-testid={`split-event-${event.id}`}
                disabled={busy}
                onClick={() => void linkEvent(event.id)}
                className="m-tap flex w-full items-center gap-3 border-b border-line-2 bg-transparent px-4 py-3 text-left last:border-0"
              >
                <Icon
                  name={detail?.attachedEventId === event.id ? 'radiobox-marked' : 'radiobox-blank'}
                  size={20}
                  color={detail?.attachedEventId === event.id ? 'var(--m-accent-deep)' : 'var(--m-ink-4)'}
                />
                <span className="min-w-0 flex-1 truncate text-[14px] text-ink">{event.name}</span>
              </button>
            ))}
            {myEvents !== null && myEvents.length === 0 && (
              <div className="px-4 py-6 text-center text-[13px] text-ink-4">{t('splits.eventEmpty')}</div>
            )}
          </div>
          {detail?.attachedEventId && (
            <Button data-testid="split-event-clear" variant="outline" disabled={busy} onClick={() => void linkEvent(null)}>
              {t('splits.eventClear')}
            </Button>
          )}
        </div>
      </Sheet>

      <Sheet open={addOpen} onOpenChange={setAddOpen} title={t('splits.addEntry')} size="tall">
        <div className="flex flex-col gap-3 pt-1">
          <button
            data-testid="split-add-from-tx"
            onClick={() => {
              setAddOpen(false);
              setTxOpen(true);
            }}
            className="m-tap flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left"
          >
            <Icon name="bank-outline" size={20} color="var(--m-accent-deep)" />
            <span className="min-w-0 flex-1">
              <span className="block text-[14px] text-ink">{t('splits.fromTx')}</span>
              <span className="block text-[11px] text-ink-4">{t('splits.fromTxSub')}</span>
            </span>
            <Icon name="chevron-right" size={18} color="var(--m-ink-4)" />
          </button>
          <div className="flex items-center gap-2">
            <div className="h-px flex-1 bg-line-2" />
            <span className="text-[11px] text-ink-4">{t('splits.orManual')}</span>
            <div className="h-px flex-1 bg-line-2" />
          </div>
          <input
            data-testid="split-entry-desc"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder={t('splits.descPlaceholder')}
            className="h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none"
          />
          <input
            data-testid="split-entry-amount"
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
            inputMode="decimal"
            placeholder={t('txform.amount')}
            className="h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none"
          />
          <div>
            <p className="mb-1 text-[12px] text-ink-3">{t('splits.whoPaid')}</p>
            <div className="flex flex-wrap gap-2">
              {(detail?.members ?? []).map((member) => (
                <button
                  key={member.userId}
                  data-testid={`split-payer-${member.userId}`}
                  onClick={() => setPaidBy(member.userId)}
                  className={`m-tap rounded-full border px-3 py-1.5 text-[13px] ${
                    (paidBy ?? me?.userId) === member.userId
                      ? 'border-accent bg-accent-soft text-accent-deep'
                      : 'border-line bg-surface text-ink-2'
                  }`}
                >
                  {memberName(member, t('word.you'))}
                </button>
              ))}
            </div>
          </div>
          {!sharesOpen && <p className="text-[12px] text-ink-4">{t('splits.equalHint')}</p>}
          <button
            data-testid="split-shares-toggle"
            onClick={() => {
              setSharesOpen((open) => !open);
              setShareInputs({});
            }}
            className={`m-tap self-start rounded-full border px-3 py-1.5 text-[13px] ${
              sharesOpen ? 'border-accent bg-accent-soft text-accent-deep' : 'border-line bg-surface text-ink-2'
            }`}
          >
            {t('splits.adjustShares')}
          </button>
          {sharesOpen && (
            <div className="flex flex-col gap-2">
              {(detail?.members ?? []).map((member) => (
                <div key={member.userId} className="flex items-center gap-3">
                  <span className="min-w-0 flex-1 truncate text-[13px] text-ink-2">{memberName(member, t('word.you'))}</span>
                  <input
                    data-testid={`split-share-${member.userId}`}
                    value={shareInputs[member.userId] ?? ''}
                    onChange={(e) => setShareInputs((prev) => ({ ...prev, [member.userId]: e.target.value }))}
                    inputMode="decimal"
                    placeholder="0,00"
                    className="h-10 w-28 rounded-input border border-line bg-surface px-3 text-right text-[14px] text-ink outline-none"
                  />
                </div>
              ))}
              {sharesRemaining !== 0 && (parseCents(amount) ?? 0) > 0 && (
                <p className="text-[12px] text-negative" data-testid="split-shares-sum">
                  {t('splits.sharesRemaining', { amount: fmtCents(sharesRemaining, detail?.currency ?? 'EUR', lang) })}
                </p>
              )}
            </div>
          )}
          <Button
            data-testid="split-entry-save"
            disabled={busy || !description.trim() || !(parseCents(amount) ?? 0) || (sharesOpen && sharesRemaining !== 0)}
            onClick={() => void addEntry()}
          >
            {t('action.save')}
          </Button>
        </div>
      </Sheet>

      {/* SP2: pick expenses from MY attached space's transactions — the
          list is read from the LOCAL database, never another member's */}
      <Sheet open={txOpen} onOpenChange={setTxOpen} title={t('splits.fromTx')} size="tall" dragHandle>
        <div className="flex h-full flex-col gap-3 pt-1">
          <SearchField
            testId="split-tx-search"
            value={txQuery}
            onChange={setTxQuery}
            placeholder={t('splits.searchTx')}
            height="h-12"
            className="shrink-0"
          />
          <div className="min-h-0 flex-1 overflow-y-auto rounded-card border border-line bg-surface">
            {(txResults ?? []).map((tx) => {
              const picked = txSelected.has(tx.id);
              return (
                <button
                  key={tx.id}
                  data-testid={`split-tx-${tx.id}`}
                  onClick={() => toggleTx(tx.id)}
                  className="m-tap flex w-full items-center gap-3 border-b border-line-2 bg-transparent px-4 py-3 text-left last:border-0"
                >
                  <Icon
                    name={picked ? 'checkbox-marked-circle' : 'checkbox-blank-circle-outline'}
                    size={20}
                    color={picked ? 'var(--m-accent-deep)' : 'var(--m-ink-4)'}
                  />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate text-[14px] text-ink">{tx.merchant}</span>
                    <span className="block text-[11px] text-ink-4">
                      {new Date(tx.date).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' })}
                    </span>
                  </span>
                  <span className="m-num text-[14px] font-semibold text-ink">
                    {fmtCents(-tx.amountCents, tx.currency, lang)}
                  </span>
                </button>
              );
            })}
            {txResults !== null && txResults.length === 0 && (
              <div className="px-4 py-6 text-center text-[13px] text-ink-4">{t('splits.noTxFound')}</div>
            )}
            {txResults === null && <div className="px-4 py-6 text-center text-[13px] text-ink-4">…</div>}
          </div>
          <Button data-testid="split-tx-add" disabled={busy || txSelected.size === 0} onClick={() => void addFromTx()}>
            {txSelected.size === 1
              ? t('splits.addSelectedOne')
              : t('splits.addSelected', { n: txSelected.size })}
          </Button>
        </div>
      </Sheet>

      <Sheet open={inviteOpen} onOpenChange={setInviteOpen} title={t('splits.inviteRow')} size="compact">
        <div className="flex flex-col gap-3 pt-1">
          <p className="text-[13px] text-ink-2">{t('splits.inviteHint')}</p>
          <div
            data-testid="split-invite-link"
            className="w-full overflow-x-auto rounded-input border border-line bg-surface px-4 py-3 font-mono text-[12px] whitespace-nowrap text-ink-2"
          >
            {inviteLink ?? '…'}
          </div>
          <p className="text-[12px] text-ink-4">{t('splits.linkExpires')}</p>
          <Button data-testid="split-invite-share" disabled={!inviteLink} onClick={() => void shareInvite()}>
            {copied ? t('splits.copied') : t('splits.copyLink')}
          </Button>
        </div>
      </Sheet>
    </div>
  );
}
