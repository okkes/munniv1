import { UNCATEGORIZED_ID, autoSubFor } from './categories';
import { primaryCatId } from './splits';
import { standardTypeFor } from './txKind';
import type { TxKind } from './txKind';
import { categoryConflictsWithType, typeForLinkedAccount } from './txType';
import type { AccountType, TxSplit, TxType } from '@/db/types';

/**
 * The review card's staged decision (review redesign, approved): every
 * control edits this DRAFT, only Confirm writes. Type ⇄ category can
 * never drift apart because every transition re-applies the coherence
 * rules — a type change that invalidates the category ASKS AGAIN
 * (user ruling #1), and splits are single-type (user ruling #2), so an
 * invalidating type change clears them together with the category.
 */
export interface ReviewDraft {
  catId?: string;
  txType: TxType;
  linkedAccountId?: string;
  splits?: TxSplit[];
}

export interface DraftCatalog {
  byId(id: string | undefined): { txTypes: TxType[] };
}

const conflicts = (catalog: DraftCatalog, catId: string | undefined, txType: TxType): boolean =>
  catId !== undefined && categoryConflictsWithType(catalog.byId(catId).txTypes, txType);

/** the card's starting point: the transaction's own state + the prediction */
export function initDraft(
  tx: { catId?: string; txType: TxType; linkedAccountId?: string; splits?: TxSplit[] },
  predictedCatId: string | undefined,
  catalog: DraftCatalog,
): ReviewDraft {
  const existing = tx.catId && tx.catId !== UNCATEGORIZED_ID ? tx.catId : undefined;
  const base: ReviewDraft = {
    txType: tx.txType,
    linkedAccountId: tx.linkedAccountId,
    splits: tx.splits?.length ? tx.splits : undefined,
  };
  return withCategory(base, existing ?? predictedCatId, catalog);
}

/** picking a category may pull the type along (to one the category speaks) */
export function withCategory(draft: ReviewDraft, catId: string | undefined, catalog: DraftCatalog): ReviewDraft {
  if (!catId) return { ...draft, catId: undefined };
  const types = catalog.byId(catId).txTypes;
  const txType = types.length === 0 || types.includes(draft.txType) ? draft.txType : types[0];
  return { ...draft, catId, txType };
}

/** picking a type clears a now-invalid category (and its splits) — ask again */
export function withType(draft: ReviewDraft, txType: TxType, catalog: DraftCatalog): ReviewDraft {
  const splitConflict = draft.splits?.some((s) => conflicts(catalog, s.catId, txType)) ?? false;
  if (splitConflict || conflicts(catalog, draft.catId, txType)) {
    return { ...draft, txType, catId: undefined, splits: undefined };
  }
  return { ...draft, txType };
}

/**
 * The simplified kind picker (user redesign): standard resolves by the
 * money's sign and drops any counterparty; transfer keeps (or awaits) a
 * counterparty — its exact family member re-derives when one is linked;
 * adjustment is a bare correction. All transitions run through withType
 * so category coherence holds.
 */
export function withKind(draft: ReviewDraft, kind: TxKind, amountCents: number, catalog: DraftCatalog): ReviewDraft {
  if (kind === 'standard') return withType({ ...draft, linkedAccountId: undefined }, standardTypeFor(amountCents), catalog);
  if (kind === 'adjustment') return withType({ ...draft, linkedAccountId: undefined }, 'adjustment', catalog);
  // transfer: an already-linked counterparty keeps its derived member;
  // otherwise plain 'transfer' until the pick (account or bare name —
  // funding included, user correction 2026-08-01) lands
  return withFamilyCategory(withType(draft, draft.linkedAccountId ? draft.txType : 'transfer', catalog), amountCents);
}

/**
 * Arc 2 (locked doors): a transfer-family draft without a REAL category
 * files under the family's sign-picked locked sub — the card reads
 * "Transfer out" instead of hiding behind the uncategorized placeholder.
 * A deliberate category (splits included) is never touched.
 */
export function withFamilyCategory(draft: ReviewDraft, amountCents: number): ReviewDraft {
  if (draft.splits?.length) return draft;
  const sub = autoSubFor(draft.txType, amountCents);
  if (!sub) return draft;
  if (draft.catId && draft.catId !== UNCATEGORIZED_ID) return draft;
  return { ...draft, catId: sub };
}

/**
 * The "no counter account" exit (arc 2): the user names the transfer-family
 * member directly. The draft is typed, files under the sign-picked locked
 * sub, and deliberately carries NO counterparty — a reporting label that
 * moves no other balance.
 */
export function withBareType(draft: ReviewDraft, txType: TxType, amountCents: number, catalog: DraftCatalog): ReviewDraft {
  return withFamilyCategory(withType({ ...draft, linkedAccountId: undefined }, txType, catalog), amountCents);
}

/** the counter-account suggests its type; the suggestion runs through
 *  withType, and a placeholder category files under the family's locked
 *  sub when the money's sign is known (arc 2) */
export function withLinkedAccount(
  draft: ReviewDraft,
  account: { id: string; type: AccountType } | null,
  catalog: DraftCatalog,
  amountCents?: number,
): ReviewDraft {
  if (!account) return { ...draft, linkedAccountId: undefined };
  const next = withType({ ...draft, linkedAccountId: account.id }, typeForLinkedAccount(account.type), catalog);
  return amountCents === undefined ? next : withFamilyCategory(next, amountCents);
}

/** splits carry the category: the largest slice represents the whole */
export function withSplits(draft: ReviewDraft, splits: TxSplit[] | undefined): ReviewDraft {
  if (!splits?.length) return { ...draft, splits: undefined };
  return { ...draft, splits, catId: primaryCatId(splits) };
}

/** Confirm is only offered once a REAL category is decided (user rule:
 *  never confirm Uncategorized — that's what review exists to fix).
 *  Transfers are the one exception: they carry no spending category and
 *  use the hidden 'uncategorized' builtin as a by-design placeholder. */
export const draftReady = (draft: ReviewDraft): boolean => {
  if (!draft.catId) return false;
  // adjustments are corrections and funding moves between books — not
  // spending; same placeholder story as plain transfers
  if (draft.txType === 'transfer' || draft.txType === 'funding' || draft.txType === 'adjustment') return true;
  if (draft.catId === 'uncategorized') return false;
  return !draft.splits?.some((slice) => slice.catId === 'uncategorized');
};
