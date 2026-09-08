import type { StorageBackend } from '@/db/backend';
import type { Repo } from '@/db/repo';
import { DEFAULT_FAMILIES, FAMILY_ACCOUNT_TYPE, defaultAccountId } from '@/domain/defaultAccounts';
import type { DefaultFamily } from '@/domain/defaultAccounts';
import { getCurrentLang } from '@/i18n';
import { en } from '@/i18n/en';
import { nl } from '@/i18n/nl';
import { tr } from '@/i18n/tr';

/**
 * #221 (user redesign): default accounts are EAGER — every space mints
 * one per family at creation, existing spaces heal on every boot, and
 * the user can never delete them. The id/family math lives in
 * domain/defaultAccounts (re-exported here so existing importers keep
 * one door); this module owns the minting.
 */
export { DEFAULT_FAMILIES, FAMILY_ACCOUNT_TYPE, defaultAccountId, defaultPickFamily } from '@/domain/defaultAccounts';
export type { DefaultFamily } from '@/domain/defaultAccounts';

type NameKey =
  | 'acct.defaultSaving'
  | 'acct.defaultLoan'
  | 'acct.defaultInvest'
  | 'acct.defaultTransfer'
  | 'acct.defaultCash'
  | 'acct.defaultFunding';

export const NAME_KEYS: Record<DefaultFamily, NameKey> = {
  saving: 'acct.defaultSaving',
  debtPayment: 'acct.defaultLoan',
  investment: 'acct.defaultInvest',
  transfer: 'acct.defaultTransfer',
  cash: 'acct.defaultCash',
  funding: 'acct.defaultFunding',
};

const DICTS = { en, nl, tr } as const;

/** the family's default account, minted idempotently (deterministic id:
 *  two devices converge by LWW; an old-device delete heals back) */
export async function ensureDefaultAccount(
  store: StorageBackend,
  repo: Repo,
  spaceId: string,
  family: DefaultFamily,
): Promise<string> {
  const id = defaultAccountId(spaceId, family);
  const existing = await store.get('account', id);
  const lang = getCurrentLang();
  const freshName = DICTS[lang]?.[NAME_KEYS[family]] ?? en[NAME_KEYS[family]];
  if (existing?.deleted === 0) {
    // #348: pre-rename cash wallets heal to the new name — but only
    // when the row still wears an old DICT name (a user rename stands)
    if (family === 'cash' && OLD_CASH_NAMES.has(existing.name) && existing.name !== freshName) {
      await repo.upsert('account', spaceId, id, { name: freshName });
    }
    return existing.id;
  }
  const space = await store.get('space', spaceId);
  await repo.upsert('account', spaceId, id, {
    name: freshName,
    type: FAMILY_ACCOUNT_TYPE[family],
    source: 'manual',
    currency: space?.currency ?? 'EUR',
    balanceCents: 0,
    defaultFor: family,
  });
  return id;
}

/** #348: the cash default's pre-rename dict names (all languages) */
const OLD_CASH_NAMES = new Set(['Default cash', 'Standaard contant', 'Varsayılan nakit']);

/** #221: the full set for ONE space — space creation calls this so the
 *  defaults exist from birth */
export async function ensureSpaceDefaultAccounts(store: StorageBackend, repo: Repo, spaceId: string): Promise<void> {
  for (const family of DEFAULT_FAMILIES) {
    // #348: the cash wallet is DELETABLE — a deliberate delete must not
    // heal back on boot. Explicit doors (the counterparty "Default"
    // pick) call ensureDefaultAccount directly and still revive it.
    if (family === 'cash') {
      const existing = await store.get('account', defaultAccountId(spaceId, 'cash'));
      if (existing && existing.deleted !== 0) continue;
    }
    await ensureDefaultAccount(store, repo, spaceId, family);
  }
}

/** #221: every live space heals on boot — pre-existing spaces, joined
 *  shared spaces, and any default an old device managed to delete.
 *  Kind-less ghost rows are skipped (the Mina liveness test): their
 *  minted defaults would haunt the global accounts overview. */
export async function ensureAllDefaultAccounts(store: StorageBackend, repo: Repo): Promise<void> {
  const spaces = (await store.allRows('space')).filter((s) => s.deleted === 0 && !!s.kind);
  for (const space of spaces) await ensureSpaceDefaultAccounts(store, repo, space.id);
}
