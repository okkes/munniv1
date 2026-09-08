import type { StorageBackend } from '@/db/backend';
import type { Repo } from '@/db/repo';
import { visibleAccounts, visibleTransactions, writeTxTransform } from '@/db/joined';
import { buildCatalog, visibleCategoryRows } from '@/domain/catalog';
import { isPaypalAccount, isPaypalFunding, matchPaypalPairs } from '@/domain/paypal';
import { applyTypeChange } from '@/domain/txType';
import { cachedCatalog } from '@/sync/catalogSync';

/**
 * PP1 rung 2: when the space sees both a PayPal feed and the funding
 * account, pair-matched funding debits auto-link as TRANSFERS to the
 * PayPal account and skip review — the purchase is counted once, on
 * the PayPal side, with the real merchant (approved ruling). Rows the
 * matcher can't settle stay untouched; the review card's own
 * counterparty defaulting handles them one tap at a time (rung 3).
 * Idempotent and conservative, mirroring linkAllCounterparties.
 */
export async function linkPaypalFunding(store: StorageBackend, repo: Repo, spaceId: string): Promise<number> {
  const accounts = await visibleAccounts(store, spaceId);
  const paypal = accounts.find((a) => isPaypalAccount(a));
  if (!paypal) return 0;

  const txs = await visibleTransactions(store, spaceId);
  const bankDebits = txs.filter(
    (t) =>
      t.deleted === 0 &&
      t.accountId !== paypal.id &&
      t.amountCents < 0 &&
      !t.linkedAccountId &&
      isPaypalFunding(t),
  );
  if (bankDebits.length === 0) return 0;
  const paypalTxs = txs.filter((t) => t.deleted === 0 && t.accountId === paypal.id);
  const pairs = matchPaypalPairs(bankDebits, paypalTxs);
  if (pairs.size === 0) return 0;

  const allSpaces = (await store.allRows('space')).filter((s) => s.deleted === 0);
  const allCats = (await store.allRows('category')).filter((c) => c.deleted === 0);
  const visible = visibleCategoryRows(allSpaces, allCats, spaceId);
  const catalog = buildCatalog(visible.rows, visible.sharedScope, visible.hiddenMains, await cachedCatalog(store));

  let linked = 0;
  for (const debit of bankDebits) {
    if (!pairs.has(debit.id)) continue;
    // same conflict rules as a manual counter-account link
    const fields = applyTypeChange({
      nextType: 'transfer',
      linkedAccountId: paypal.id,
      currentCatId: debit.catId,
      catTxTypes: catalog.byId(debit.catId).txTypes,
      amountCents: debit.amountCents,
    });
    await writeTxTransform(repo, debit, { ...fields, needsReview: 0 });
    linked++;
  }
  return linked;
}
