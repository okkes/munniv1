import { useEffect, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useLang } from '@/i18n';
import { useSession } from '@/app/session';
import { apiFetch } from '@/lib/api';
import { fmtCents } from '@/lib/money';
import { netPositions } from '@/domain/splitLedger';
import { Icon } from '@/ui/Icon';

interface Summary {
  splitId: string;
  name: string;
  net: number;
  currency: string;
  settled: boolean;
}

/**
 * "Split: Barcelona · you're owed €x" row on the event detail (SP5).
 * Splits are online-only, so this renders nothing when offline, signed
 * out, or when no split of mine is linked to this event.
 */
export function SplitEventSummary({ eventId }: Readonly<{ eventId: string }>) {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const { identity } = useSession();
  const [summary, setSummary] = useState<Summary | null>(null);

  useEffect(() => {
    if (identity?.kind !== 'user') return;
    let stale = false;
    void (async () => {
      const list = await apiFetch('/splits').catch(() => null);
      if (!list?.ok) return;
      const splits = (await list.json()) as { id: string; attachedEventId?: string | null }[];
      const mine = splits.find((s) => s.attachedEventId === eventId);
      if (!mine) return;
      const res = await apiFetch(`/splits/${mine.id}`).catch(() => null);
      if (!res?.ok) return;
      const detail = (await res.json()) as {
        id: string;
        name: string;
        currency: string;
        status: string;
        members: { userId: string; isMe: boolean }[];
        entries: { paidByUserId: string; amountCents: number; shares: { userId: string; cents: number }[] }[];
      };
      const nets = netPositions(
        detail.entries.map((e) => ({ paidByUserId: e.paidByUserId, amountCents: e.amountCents, shares: e.shares })),
        detail.members.map((m) => m.userId),
      );
      const me = detail.members.find((m) => m.isMe);
      if (!stale) {
        setSummary({
          splitId: detail.id,
          name: detail.name,
          net: (me && nets.get(me.userId)) ?? 0,
          currency: detail.currency,
          settled: detail.status === 'settled',
        });
      }
    })();
    return () => {
      stale = true;
    };
  }, [identity, eventId]);

  if (!summary) return null;
  const summaryLine = () => {
    if (summary.settled) return t('splits.settled');
    if (summary.net > 0) return t('splits.summaryOwed', { amount: fmtCents(summary.net, summary.currency, lang) });
    if (summary.net < 0) return t('splits.summaryOwe', { amount: fmtCents(-summary.net, summary.currency, lang) });
    return t('splits.summaryEven');
  };
  const line = summaryLine();
  return (
    <button
      data-testid="event-split-summary"
      onClick={() => void navigate({ to: '/splits/$splitId', params: { splitId: summary.splitId } })}
      className="m-tap mt-3 flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left"
    >
      <Icon name="account-cash-outline" size={20} color="var(--m-accent-deep)" />
      <span className="min-w-0 flex-1">
        <span className="block truncate text-[14px] text-ink">{summary.name}</span>
        <span className="block text-[11px] text-ink-4">{line}</span>
      </span>
      <Icon name="chevron-right" size={18} color="var(--m-ink-4)" />
    </button>
  );
}
