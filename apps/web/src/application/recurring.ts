import { useEffect } from 'react';
import { useData } from '@/app/data';
import { appendNotification } from './notifications';
import { LOCALES, useLang } from '@/i18n';
import { visibleTransactions, writeTxTransform } from '@/db/joined';
import type { SpaceTx } from '@/db/joined';
import { isDebtTracked } from '@/domain/debts';
import { merchantKey } from '@/domain/merchantKey';
import { addDays, cycleKeyOf, nextDueDate, recurringAmountMatches } from '@/domain/recurring';
import { recurringDismissId } from '@/domain/feedIds';
import { logActivity, logRowActivity } from './activity';
import { txTitle } from '@/lib/text';
import type { StorageBackend } from '@/db/backend';
import { useQuery } from '@/db/useQuery';
import type { Repo } from '@/db/repo';
import type { RecurringRow } from '@/db/types';

/** Application layer for recurring costs (architecture R1). */

const pad = (n: number) => String(n).padStart(2, '0');
export const localToday = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

/** the active space's recurring rows, alphabetical */
export function useRecurrings(): RecurringRow[] | undefined {
  const { store, spaceId } = useData();
  return useQuery(
    store,
    async () => {
      const rows = (await store.bySpace('recurring', spaceId)).filter((r) => r.deleted === 0);
      rows.sort((a, b) => a.name.localeCompare(b.name));
      return rows;
    },
    [spaceId],
  );
}

/**
 * The recurring OWNS its transactions' category (user rule 2026-07-28):
 * changing it re-files every linked transaction. The reimbursement
 * exception survives: rows the user filed as EXPECTED reimbursement and
 * rows settlement filed as REIMBURSED keep their attribution — those
 * default back to the recurring's category only when the link/settling
 * goes away, which the reimbursement flow already handles.
 */
export async function propagateRecurringCategory(
  store: StorageBackend,
  repo: Repo,
  spaceId: string,
  recurringId: string,
  catId: string = 'uncategorized',
  linkedAccountId?: string,
): Promise<number> {
  let touched = 0;
  for (const tx of await visibleTransactions(store, spaceId)) {
    if (tx.deleted !== 0 || tx.recurringId !== recurringId) continue;
    if (tx.catId === 'reimbursed' || tx.catId === 'expenseReimburse') continue;
    // #274 (user): the recurring's counterparty rides to its rows — the
    // choke mints the manual counter leg per row ("bulk create")
    const linkField =
      linkedAccountId && tx.linkedAccountId !== linkedAccountId ? { linkedAccountId } : {};
    if (tx.catId === catId && !('linkedAccountId' in linkField)) continue;
    // #260 r2 (user): the recurring applying its category IS the review
    await writeTxTransform(repo, tx, { catId, needsReview: 0, ...linkField });
    touched++;
  }
  return touched;
}

/** merchant patterns this space already rejected as suggestions */
export function useDismissedKeys(): ReadonlySet<string> | undefined {
  const { store, spaceId } = useData();
  return useQuery(
    store,
    async () => {
      const rows = (await store.bySpace('recurringDismiss', spaceId)).filter((r) => r.deleted === 0);
      return new Set(rows.map((r) => r.merchantKey));
    },
    [spaceId],
  );
}

export interface RecurringOps {
  save: (id: string | null, fields: Partial<RecurringRow>) => Promise<string>;
  remove: (id: string) => Promise<void>;
  dismissSuggestion: (key: string) => Promise<void>;
  /** '' unlinks — an absent field would not sync a change at all */
  linkTx: (tx: SpaceTx, recurringId: string) => Promise<void>;
  reconcile: () => Promise<number>;
}

export function useRecurringOps(): RecurringOps {
  const { store, repo, spaceId } = useData();
  return {
    save: async (id, fields) => {
      const rowId = id ?? repo.newId();
      await repo.upsert('recurring', spaceId, rowId, fields);
      void logRowActivity(store, repo, spaceId, 'recurring', rowId, id ? 'recEdit' : 'recAdd', fields.name);
      return rowId;
    },
    remove: async (id) => {
      await logRowActivity(store, repo, spaceId, 'recurring', id, 'recRemove');
      await repo.remove('recurring', spaceId, id);
    },
    dismissSuggestion: (key) =>
      repo.upsert('recurringDismiss', spaceId, recurringDismissId(spaceId, key), { merchantKey: key }),
    linkTx: async (tx, recurringId) => {
      // the recurring OWNS the category (user rule 2026-07-28): linking
      // re-files the transaction — unless the user filed it as expected
      // reimbursement or settlement filed it as reimbursed
      const rec = recurringId ? await store.get('recurring', recurringId) : undefined;
      // #260 r2 (user): the refile counts as the review — linked rows
      // must not keep wearing the unreviewed badge
      const refile =
        rec?.catId && tx.catId !== rec.catId && tx.catId !== 'reimbursed' && tx.catId !== 'expenseReimburse'
          ? { catId: rec.catId, needsReview: 0 as const }
          : {};
      // #274 (user): the recurring's counterparty rides to its rows —
      // for a manual counter the choke mints the leg right here
      const counter =
        rec?.linkedAccountId && tx.linkedAccountId !== rec.linkedAccountId
          ? { linkedAccountId: rec.linkedAccountId }
          : {};
      await writeTxTransform(repo, tx, { recurringId, ...refile, ...counter });
      void logActivity(store, repo, spaceId, 'txLink', txTitle(tx));
    },
    reconcile: () => reconcileRecurringLinks(store, repo, spaceId),
  };
}

/** rows the auto-linker considers at all — unlinked outgoing expense or
 *  funding money (#264: pot top-ups are recurring-shaped too). S3776. */
const reconcilableRow = (tx: SpaceTx): boolean =>
  !tx.recurringId && tx.amountCents < 0 && (tx.txType === 'expense' || tx.txType === 'funding');

/**
 * Auto-link unlinked expenses to active recurrings by merchant pattern:
 * same normalized merchant, amount within 25% of the estimate, at most
 * one transaction per billing cycle. Idempotent — runs after imports
 * and on opening the Recurring screen.
 */
export async function reconcileRecurringLinks(store: StorageBackend, repo: Repo, spaceId: string): Promise<number> {
  const recs = (await store.bySpace('recurring', spaceId)).filter(
    (r) => r.deleted === 0 && r.active === 1 && !!r.merchantKey,
  );
  if (recs.length === 0) return 0;

  const txs = await visibleTransactions(store, spaceId);
  const byKey = new Map(recs.map((r) => [r.merchantKey!, r]));

  const linkedCycles = new Map<string, Set<string>>();
  for (const tx of txs) {
    if (!tx.recurringId) continue;
    const rec = recs.find((r) => r.id === tx.recurringId);
    if (!rec) continue;
    const set = linkedCycles.get(rec.id) ?? new Set();
    set.add(cycleKeyOf(rec, tx.date));
    linkedCycles.set(rec.id, set);
  }

  let linked = 0;
  for (const tx of [...txs].sort((a, b) => a.date.localeCompare(b.date))) {
    if (!reconcilableRow(tx)) continue;
    // #126 r7: a split container never takes a row-level recurring link —
    // its parts carry their own (linked by hand from the part surfaces)
    if ((tx.splits ?? []).filter((s) => s.catId !== 'reimbursed').length > 1) continue;
    const rec = byKey.get(merchantKey(tx.merchant));
    if (!rec || !recurringAmountMatches(rec, tx.amountCents)) continue;
    const cycle = cycleKeyOf(rec, tx.date);
    const cycles = linkedCycles.get(rec.id) ?? new Set();
    if (cycles.has(cycle)) continue; // one payment per billing cycle
    cycles.add(cycle);
    linkedCycles.set(rec.id, cycles);
    await writeTxTransform(repo, tx, { recurringId: rec.id });
    linked++;
  }
  return linked;
}

/**
 * Local reminders: while the app is open (or being opened), recurrings
 * with a reminder window that has started fire one notification per due
 * date. Best-effort by design — reliable killed-app reminders would
 * need server-side scheduling, which recurring data deliberately avoids.
 */
export function useRecurringReminders(): void {
  const { store } = useData();
  const { t, lang } = useLang();
  useEffect(() => {
    void (async () => {
      // the in-app inbox records every event (arc 6) — the OS
      // notification is the optional second outlet, permission allowing
      const granted = typeof Notification !== 'undefined' && Notification.permission === 'granted';
      const registration = granted ? await navigator.serviceWorker?.ready.catch(() => undefined) : undefined;

      const today = localToday();
      const recs = (await store.allRows('recurring')).filter(
        (r) => r.deleted === 0 && r.active === 1 && (r.notifyDaysBefore ?? 0) > 0,
      );
      for (const rec of recs) {
        const next = nextDueDate(rec, today);
        if (!next || next > addDays(today, rec.notifyDaysBefore ?? 0)) continue;
        const key = `recNotified_${rec.id}_${next}`;
        if (await store.metaGet(key)) continue; // one reminder per due date
        await store.metaPut(key, Date.now());
        const date = new Date(next).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short' });
        await appendNotification(store, 'recurringDue', { name: rec.name, date }, key);
        if (registration) {
          await registration.showNotification('munni', {
            body: t('recurring.reminderBody', { name: rec.name, date }),
            icon: 'icon-192.png',
            badge: 'icon-192.png',
            tag: `rec-remind-${rec.id}`,
            data: { url: './#/recurring' },
          });
        }
      }

      // loans saved without an interest rate get a WEEKLY nudge to fill
      // it in — 0% is an answer, an empty rate is a question (user rule
      // 2026-07-28); quick-add now, find out the rate later. Loans v2:
      // the tracked liability ACCOUNTS are the debts now. #221: the
      // minted DEFAULT pot is munni's fixture, not a user loan — no nag.
      const loans = (await store.allRows('account')).filter(
        (a) => a.deleted === 0 && a.archived !== 1 && !a.defaultFor && a.interestPctYear === undefined && isDebtTracked(a),
      );
      for (const loan of loans) {
        const key = `debtPctReminded_${loan.id}`;
        // metaGet returns the {key, value} row — reading the row itself as
        // a number made the 7-day check NaN and the nudge fired every open
        const last = (await store.metaGet(key))?.value as number | undefined;
        if (last && Date.now() - last < 7 * 86_400_000) continue;
        await store.metaPut(key, Date.now());
        await appendNotification(store, 'debtRate', { name: loan.name }, `${key}_${Date.now()}`);
        if (registration) {
          await registration.showNotification('munni', {
            body: t('debts.rateReminderBody', { name: loan.name }),
            icon: 'icon-192.png',
            badge: 'icon-192.png',
            tag: `debt-rate-${loan.id}`,
            data: { url: './#/debts' },
          });
        }
      }
    })().catch(() => undefined); // reminders are best-effort; a closing db must not throw
  }, [store, t, lang]);
}
