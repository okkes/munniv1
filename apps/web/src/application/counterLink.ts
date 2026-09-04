import { visibleAccounts, visibleTransactions, writeTxTransform } from '@/db/joined';
import type { StorageBackend } from '@/db/backend';
import type { Repo } from '@/db/repo';
import { normalizeIban } from '@/domain/feedIds';
import { applyTypeChange, typeForLinkedAccount } from '@/domain/txType';
import { buildCatalog, visibleCategoryRows } from '@/domain/catalog';
import { cachedCatalog } from '@/sync/catalogSync';

/**
 * Retroactive counterparty linking (user rule 2026-07-17): the moment a
 * new financial account exists in a space, every transaction whose
 * counterparty IBAN belongs to that account becomes a link to it —
 * "import 3 months from checking, then connect the credit card: the
 * top-ups all point at the card now".
 *
 * Idempotent and conservative: rows that already carry a link are never
 * touched, and the type only moves off plain expense/income (deliberate
 * types survive). Category conflicts resolve exactly like a manual link
 * (applyTypeChange). Returns how many rows were linked.
 */
export async function linkAllCounterparties(store: StorageBackend, repo: Repo, spaceId: string): Promise<number> {
  const accounts = await visibleAccounts(store, spaceId);
  const byIban = new Map<string, (typeof accounts)[number]>();
  for (const account of accounts) {
    if (account.iban) byIban.set(normalizeIban(account.iban), account);
  }
  if (byIban.size === 0) return 0;

  const allSpaces = (await store.allRows('space')).filter((s) => s.deleted === 0);
  const allCats = (await store.allRows('category')).filter((c) => c.deleted === 0);
  const visible = visibleCategoryRows(allSpaces, allCats, spaceId);
  const catalog = buildCatalog(visible.rows, visible.sharedScope, visible.hiddenMains, await cachedCatalog(store));

  let linked = 0;
  for (const tx of await visibleTransactions(store, spaceId)) {
    if (!tx.counterIban || tx.linkedAccountId) continue;
    const account = byIban.get(normalizeIban(tx.counterIban));
    if (!account || account.id === tx.accountId) continue;
    const keepType = tx.txType !== 'expense' && tx.txType !== 'income';
    const nextType = keepType ? tx.txType : typeForLinkedAccount(account.type);
    const fields = applyTypeChange({
      nextType,
      linkedAccountId: account.id,
      currentCatId: tx.catId,
      catTxTypes: catalog.byId(tx.catId).txTypes,
      amountCents: tx.amountCents,
    });
    await writeTxTransform(repo, tx, fields);
    linked++;
  }
  return linked;
}
