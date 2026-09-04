import { UNCATEGORIZED_ID, autoSubFor, isMovementCat, stampMovementSub } from './categories';
import { defaultFamilyFor } from './defaultAccounts';
import { primaryCatId } from './splits';
import { standardTypeFor } from './txKind';
import type { TxKind } from './txKind';
import { categoryConflictsWithType, familyForCounter, movementCatFor } from './txType';
import type { AccountType, TxSplit, TxSplitCat, TxType } from '@/db/types';

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
  /** #211: the row's own category spread — one transaction, several
   *  categories; mutually exclusive with a staged split's parts */
  cats?: TxSplitCat[];
  splits?: TxSplit[];
}

export interface DraftCatalog {
  byId(id: string | undefined): { txTypes: TxType[] };
}

const conflicts = (catalog: DraftCatalog, catId: string | undefined, txType: TxType): boolean =>
  catId !== undefined && categoryConflictsWithType(catalog.byId(catId).txTypes, txType);

/** the card's starting point: the transaction's own state + the prediction */
export function initDraft(
  tx: { catId?: string; txType: TxType; linkedAccountId?: string; cats?: TxSplitCat[]; splits?: TxSplit[] },
  predictedCatId: string | undefined,
  catalog: DraftCatalog,
): ReviewDraft {
  const existing = tx.catId && tx.catId !== UNCATEGORIZED_ID ? tx.catId : undefined;
  const base: ReviewDraft = {
    txType: tx.txType,
    linkedAccountId: tx.linkedAccountId,
    cats: tx.cats?.length ? tx.cats : undefined,
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

/** picking a type clears a now-invalid category (and its partition —
 *  parts or spread alike) — ask again */
export function withType(draft: ReviewDraft, txType: TxType, catalog: DraftCatalog): ReviewDraft {
  const partitionConflict =
    [...(draft.splits ?? []), ...(draft.cats ?? [])].some((s) => conflicts(catalog, s.catId, txType));
  if (partitionConflict || conflicts(catalog, draft.catId, txType)) {
    return { ...draft, txType, catId: undefined, cats: undefined, splits: undefined };
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
  if (draft.splits?.length || draft.cats?.length) return draft;
  const sub = autoSubFor(draft.txType, amountCents);
  if (!sub) return draft;
  if (draft.catId && draft.catId !== UNCATEGORIZED_ID) return draft;
  return { ...draft, catId: sub };
}

// withBareType retired 2026-08-05 (typed-splits v2, R2): the bare
// stories live on the marked special CATEGORIES of standard rows now —
// picking one pulls the type through withCategory's coherence rules.

/** the counter-account names the FAMILY (#133 r5 bijection — a savings
 *  counter means the saving story, not a blanket transfer); a
 *  conflicting or placeholder category files under the family's
 *  sign-picked sub. A STAMPED row (R1) keeps its stamp instead — naming
 *  a counterparty makes it a movement, so the movement sub is FORCED
 *  from the special account's own side (Q8: + = set aside / repaid). */
export function withLinkedAccount(
  draft: ReviewDraft,
  account: { id: string; type: AccountType } | null,
  catalog: DraftCatalog,
  amountCents?: number,
  ownStamp?: TxType,
): ReviewDraft {
  if (!account) return { ...draft, linkedAccountId: undefined };
  if (ownStamp) {
    return {
      ...draft,
      linkedAccountId: account.id,
      txType: ownStamp,
      ...(amountCents === undefined ? {} : { catId: stampMovementSub(ownStamp, amountCents) }),
    };
  }
  const next = withType({ ...draft, linkedAccountId: account.id }, familyForCounter(account.type), catalog);
  return amountCents === undefined ? next : withCounterCategory(next, account.type, amountCents);
}

/** withFamilyCategory's exact-bijection sibling: a placeholder category
 *  files THE sub the counter's kind means (the ATM pair for cash
 *  wallets); a deliberate surviving category is never touched. */
function withCounterCategory(draft: ReviewDraft, accountType: AccountType, amountCents: number): ReviewDraft {
  if (draft.splits?.length || draft.cats?.length) return draft;
  if (draft.catId && draft.catId !== UNCATEGORIZED_ID) return draft;
  return { ...draft, catId: movementCatFor(accountType, amountCents) };
}

/** splits carry the category: the largest slice represents the whole.
 *  A container owns no category spread (#211) — staging parts clears it. */
export function withSplits(draft: ReviewDraft, splits: TxSplit[] | undefined): ReviewDraft {
  if (!splits?.length) return { ...draft, splits: undefined };
  return { ...draft, splits, cats: undefined, catId: primaryCatId(splits) };
}

/** #211: the row's own spread — several categories, ONE transaction.
 *  One entry collapses back to the plain category; several keep the
 *  spread with the largest entry as the compat shadow. Parts clear:
 *  the two features never mix. */
export function withCats(draft: ReviewDraft, entries: TxSplitCat[] | undefined): ReviewDraft {
  if (!entries || entries.length <= 1) {
    return { ...draft, cats: undefined, ...(entries?.length ? { catId: entries[0].catId } : {}) };
  }
  const primary = entries.reduce((best, e) => (e.amountCents > best.amountCents ? e : best), entries[0]);
  return { ...draft, cats: entries, splits: undefined, catId: primary.catId };
}

/** Confirm is only offered once a REAL category is decided (user rule:
 *  never confirm Uncategorized — that's what review exists to fix).
 *  Transfers are the one exception: they carry no spending category and
 *  use the hidden 'uncategorized' builtin as a by-design placeholder. */
export const draftReady = (draft: ReviewDraft): boolean => {
  if (!draft.catId) return false;
  // R2 (typed-splits v2): a transfer strictly needs its tracked counter
  // account — a MOVEMENT category stays "ready" while bare so Confirm
  // remains TAPPABLE, but the tap now refuses with the red
  // "Counterparty required" field (#309, user) instead of silently
  // linking the family default (#221's old fallback); the ask's pinned
  // Default row is the deliberate one-tap path. #228 r3 (user rule):
  // the TRANSFER family has no default — a bare transfer never confirms.
  if (draft.txType === 'transfer') {
    return !!draft.linkedAccountId || (isMovementCat(draft.catId) && defaultFamilyFor(draft.catId) !== 'transfer');
  }
  // adjustments are corrections — not spending; same placeholder story.
  // ('funding' only serves unmigrated rows since the type retired.)
  if (draft.txType === 'funding' || draft.txType === 'adjustment') return true;
  // #126 r7 (user rule): no restriction on a split beyond the amounts —
  // the ONLY hold-back left is an uncategorized part, and the deck marks
  // it with an attention badge when Confirm is tried
  if (draft.catId === 'uncategorized') return false;
  return ![...(draft.splits ?? []), ...(draft.cats ?? [])].some((slice) => slice.catId === 'uncategorized');
};
