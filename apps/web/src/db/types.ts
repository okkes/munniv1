import type { SyncEnvelope } from '@/sync/merge';

/**
 * v1 data model. Every synced row carries the SyncEnvelope (fieldVersions +
 * derived deleted flag) and belongs to exactly one space — the unit of
 * sharing and sync.
 *
 * Money is stored as integer minor units (cents), never floats.
 */

export type SpaceKind = 'personal' | 'shared';

export type SpacePeriodType = 'month' | 'week' | 'biweekly' | 'custom';

export interface SpaceRow extends SyncEnvelope {
  id: string;
  name: string;
  kind: SpaceKind;
  currency: string; // ISO 4217, e.g. 'EUR'
  periodType: SpacePeriodType;
  periodDay: number; // day of month the budget period starts (month type)
  /** creator's display name at creation — distinguishes same-named
   *  shared spaces in lists (user rule; private names stay unique) */
  createdByName?: string;
  /** custom image (small data URL, client-downscaled) — wins over `icon` in lists */
  picture?: string;
  /** MDI icon shown in lists (default 'leaf') */
  icon?: string;
  color?: string;
  /** default start date (yyyy-mm-dd) for transaction history when accounts get attached */
  historyStartDate?: string;
  /** private lock (arc 4): 1 = invites disabled until the owner unlocks.
   *  New spaces create locked; absent (pre-arc rows) reads unlocked. */
  inviteLock?: 0 | 1;
  /** landing-zone layout: block order + visibility, per space (synced) */
  homeBlocks?: { id: string; hidden?: 0 | 1 }[];
  /** tx-detail layout: section order + visibility under the fixed details block */
  txDetailBlocks?: { id: string; hidden?: 0 | 1 }[];
  /** allocation: roll category leftovers into the next period (default on) */
  allocRollover?: 0 | 1;
  /** main categories switched off for this space (picker filtering only — data never blocks) */
  hiddenMains?: string[];
  /** Home balance band (user design 2026-08-01): what the big number IS.
   *  Absent = 'networth' (the pre-config behavior: every account summed). */
  balanceBandMode?: 'networth' | 'cash' | 'spendable' | 'custom';
  /** accounts excluded from the networth/cash band sums */
  balanceBandExclude?: string[];
  /** the custom mode's explicit include list */
  balanceBandAccounts?: string[];
}

export type AccountType = 'checking' | 'savings' | 'cash' | 'brokerage' | 'credit' | 'mortgage' | 'loan' | 'funding';
export type AccountSource = 'manual' | 'camt053' | 'gocardless';
/** which open-banking provider fetches a 'gocardless'-sourced account —
 *  absent on legacy rows means GoCardless (#176) */
export type BankProvider = 'gocardless' | 'enablebanking';

export interface AccountRow extends SyncEnvelope {
  id: string;
  spaceId: string;
  name: string;
  type: AccountType;
  source: AccountSource;
  currency: string;
  balanceCents: number;
  /** date balanceCents was known true (yyyy-mm-dd): statement balances and
   *  manual edits both stamp it, and only a newer date may overwrite */
  balanceAsOf?: string;
  /** when this account last heard from its source (ISO; bank fetch or statement import) */
  lastSyncedAt?: string;
  /** #176: the open-banking provider behind a 'gocardless' source —
   *  stamped by the server ingest; absent = GoCardless (legacy rows) */
  provider?: BankProvider;
  /** #133/#221: this account is the space's DEFAULT for a counterparty
   *  family — minted at space creation (undeletable, ledger system-
   *  managed), so "Set aside" or an ATM withdrawal without naming an
   *  account lands somewhere valid */
  defaultFor?: 'saving' | 'debtPayment' | 'investment' | 'transfer' | 'cash' | 'funding';
  /** newest transaction date an imported statement covered (yyyy-mm-dd):
   *  "you imported five minutes ago" and "the data ends three weeks ago"
   *  are different facts — this carries the second one */
  dataThroughDate?: string;
  /** #240 r3: what the last bank fetch actually carried — raw rows the
   *  provider answered with, and how many could not be stored (no
   *  reference/date). 0 received = "the bank returned nothing", which
   *  used to be indistinguishable from a healthy sync. */
  lastFetchReceived?: number;
  lastFetchDropped?: number;
  iban?: string;
  bankId?: string;
  color?: string;
  /** user-chosen icon override: '/brands/{slug}.svg' or a logo.dev URL —
   *  wins over the institution logo derived from bankId */
  logo?: string;
  archived?: 0 | 1;
  // ── loans v2 (2026-08-01): the liability account IS the debt — the
  //    old DebtRow's story fields live here now, one object, no seams
  /** informational APR, e.g. 3.5 — empty means "remind me", 0 is an answer */
  interestPctYear?: number;
  /** starting size of the loan — optional garnish powering the progress bar */
  originalCents?: number;
  /** free-form note */
  note?: string;
  paymentCents?: number;
  /** payment cadence, recurring-shaped: every N week/month/year; absent =
   *  monthly, estimates from payments fill the gap */
  paymentEvery?: RecurringEvery;
  paymentEveryN?: number;
  /** #190: due day of month 1..31 (like recurring) — says which period a
   *  payment belongs to; weekly cadences carry none */
  paymentDay?: number;
  /** auto-link payments by merchant (the recurring→loan handoff) */
  merchantKey?: string;
  /** debts-screen membership: absent = by type (loan/mortgage in, credit
   *  out unless it carries a debt story) — the explicit toggle wins */
  trackAsDebt?: 0 | 1;
}

export type TxType = 'income' | 'expense' | 'saving' | 'transfer' | 'debtPayment' | 'investment' | 'funding' | 'adjustment';

export type CatDirection = 'debit' | 'credit' | 'both';

/**
 * Custom category row. Main (parent) categories carry the transaction
 * type + color; sub categories inherit both from their parent and carry
 * only a direction (which side of the ledger they may be used on).
 * Rows live in the space they were created in: a personal space makes
 * them user-scoped (visible across all the user's personal spaces), a
 * shared space makes them visible to that space's members only.
 */
export interface CategoryRow extends SyncEnvelope {
  id: string;
  spaceId: string;
  parentId?: string;
  /** translation key for built-in categories (e.g. 'cat.groceries') */
  nameKey?: string;
  /** user-entered name for custom categories */
  name?: string;
  icon: string; // MDI icon name
  color: string;
  /** authoritative on parents; derived from the parent for subs */
  txType: TxType;
  /** subs only; parents have no direction */
  direction?: CatDirection;
  /** custom main category (no parentId) */
  isParent?: 0 | 1;
  /** the auto-created "Other" sub of a custom main (direction locked to 'both') */
  isOther?: 0 | 1;
  sortOrder: number;
  builtin: 0 | 1;
}

export interface TxSplit {
  catId: string;
  /** positive magnitude; the parent row's sign gives the direction */
  amountCents: number;
  /** percentage split (0–100): scales to any amount, so bulk apply
   *  works across different charges; amountCents stays materialized */
  pct?: number;
  // ── typed splits v2 (2026-08-05, approved plan) — all optional; a
  // bare slice behaves exactly as the classic category slice ──
  /** stable part identity (repo.newId()), minted when the sheet saves */
  id?: string;
  /** stored ONLY when the user edits it; the default
   *  "<title> – split N" is rendered, localized, at read time */
  label?: string;
  /** the part's own type (R4: the parent is a container) —
   *  absent = the part inherits the row's type */
  txType?: TxType;
  /** transfer parts: the tracked counter account (mint-on-link) */
  linkedAccountId?: string;
  /** the paired row on that account (the part's minted mirror) */
  transferPeerId?: string;
  /** per-part event membership ("this €30 of the dinner is the trip") */
  eventId?: string;
  /** per-part recurring link (#126 r7: parts carry everything a whole
   *  transaction carries — the €50 device-plan part ↔ its recurring) */
  recurringId?: string;
  /** per-part category partition (splits v2.1): a part can spread across
   *  several categories. Magnitudes sum to the part's amountCents; catId
   *  stays the largest entry as the compat shadow. Absent = single cat. */
  cats?: TxSplitCat[];
  /** the part's own note (#126 r5: parts are full transactions) */
  notes?: string;
}

export interface TxSplitCat {
  catId: string;
  /** positive magnitude, same sign convention as the part */
  amountCents: number;
  /** percentage entry (0–100), row-level spreads only (#211): kept when
   *  the spread was typed in % so the #141 sibling offer can rescale;
   *  amountCents stays materialized either way */
  pct?: number;
  // ── #228 (user 2026-08-13): entries carry NO counterparty anymore.
  // One counterparty per (split) transaction — the row's or part's own
  // linkedAccountId/transferPeerId — and a special category claims the
  // whole (split) transaction, so a spread only ever holds regular and
  // reimbursement categories. Old per-entry links (the #133 r4 model)
  // are relocated by the every-boot fold (migrateEntryCounters). ──
  /** VIEW enrichment only (like a part's): the join derives it from the
   *  entry's category + the owner's counterparty; a stored value is
   *  never read */
  txType?: TxType;
}

/** money received back against an expense (owned by the expense side) */
export interface TxReimbursement {
  /** the credit transaction that pays (part of) this expense back */
  txId: string;
  amountCents: number;
  /** which PART of a split expense it pays back (#126 r5) — absent =
   *  the whole transaction; container math is unchanged either way */
  partId?: string;
  /** #197: which PART of a split CREDIT funds it — absent = the whole
   *  credit; whole-credit math is unchanged either way */
  creditPartId?: string;
}

export interface TransactionRow extends SyncEnvelope {
  id: string;
  spaceId: string;
  accountId: string;
  date: string; // ISO yyyy-mm-dd (sortable)
  time?: string; // HH:mm
  amountCents: number; // negative = money out
  currency: string;
  merchant: string;
  /** user-chosen display title; the bank's merchant stays untouched */
  titleOverride?: string;
  description?: string;
  catId?: string;
  /** #211 split categories: the ROW's own multi-category partition —
   *  magnitudes sum to |amountCents|, catId stays the largest entry as
   *  the compat shadow. A row with `cats` is still ONE transaction.
   *  `splits` is the OTHER feature (a container's parts) — the two
   *  never mix: containers carry no cats of their own. */
  cats?: TxSplitCat[];
  splits?: TxSplit[];
  txType: TxType;
  needsReview: 0 | 1;
  notes?: string;
  counterIban?: string;
  /** bank-reported reserved charge, not yet booked — replaced by its booked twin */
  pending?: 0 | 1;
  /** deterministic id source for imported rows (bank tx id / CAMT entry ref) */
  importRef?: string;
  /** master plan IB: which upload created this row — rollback removes a
   *  batch's rows and ONLY its rows (deduped rows keep their first batch) */
  importBatchId?: string;
  /** display name of the uploader at import time (frozen, like activity) */
  importedBy?: string;
  reimbursements?: TxReimbursement[];
  /** counter-account for transfers/savings/debt payments — locks txType */
  linkedAccountId?: string;
  /** the MIRROR transaction of a transfer pair (the other account's leg)
   *  — written on both legs by the matcher or a manual link; the list
   *  collapses a visible pair into one row */
  transferPeerId?: string;
  /** the recurring cost this expense pays (rent, a subscription, …) */
  recurringId?: string;
  /** the event this transaction belongs to (holiday, wedding, …) */
  eventId?: string;
  /** loans v2 (2026-08-01): pre-anchor row deliberately counted into
   *  the linked manual loan's balance (one-shot marker) */
  loanCounted?: 1;
  /** #133 D (C3): the manual correction marker — adjustment stopped
   *  being a type; manual rows only */
  adjustment?: 0 | 1;
}

/**
 * Per-space transformation overlay for one raw transaction (feature B:
 * raw bank data lives once in the account's feed space; every attached
 * space keeps its own opinions about it). Deterministic id
 * uuidv5("meta:" + spaceId + ":" + txId) — concurrent creation by two
 * members converges via LWW.
 */
export interface TxMetaRow extends SyncEnvelope {
  id: string;
  /** the viewing space that owns these opinions */
  spaceId: string;
  /** raw transaction id inside the feed space */
  txId: string;
  catId?: string;
  txType: TxType;
  needsReview: 0 | 1;
  notes?: string;
  /** user-chosen display title; the bank's merchant stays untouched */
  titleOverride?: string;
  /** #211: the space's multi-category partition of the raw row */
  cats?: TxSplitCat[];
  splits?: TxSplit[];
  reimbursements?: TxReimbursement[];
  linkedAccountId?: string;
  transferPeerId?: string;
  recurringId?: string;
  eventId?: string;
  /** loans v2 (2026-08-01): this row predates the loan's known-true
   *  balance date but the user chose to count it in anyway (one-shot) */
  loanCounted?: 1;
}

export type RecurringKind = 'fixed' | 'subscription';
export type RecurringEvery = 'week' | 'month' | 'year';

/**
 * One recurring cost of a space (rent, Netflix, insurance …). The
 * amount is the user's estimate until linked transactions rectify it;
 * merchantKey lets imports auto-link. Scoped per space — shared spaces
 * share their recurring configuration.
 */
export interface RecurringRow extends SyncEnvelope {
  id: string;
  spaceId: string;
  name: string;
  kind: RecurringKind;
  /** could be cancelled anytime without real impact (insight label) */
  luxury?: 0 | 1;
  /** estimated cost per occurrence, positive minor units */
  amountCents: number;
  catId?: string;
  icon?: string;
  /** brand logo: '/brands/{slug}.svg' (vendored, offline) or a logo.dev URL — wins over `icon` */
  logo?: string;
  every: RecurringEvery;
  /** cadence multiplier: every N weeks/months/years (default 1); N>1 and
   *  weekly cadences anchor on `since` */
  everyN?: number;
  /** due day of month 1..31 (clamped to shorter months) */
  dueDay: number;
  /** yearly costs: due month 1..12 */
  dueMonth?: number;
  since?: string;
  until?: string;
  active: 0 | 1;
  /** remind n days before due; absent/0 = no reminder */
  notifyDaysBefore?: number;
  /** normalized merchant (domain/merchantKey) for auto-linking */
  merchantKey?: string;
  /** #274: counterparty account for special categories — linked
   *  transactions inherit it (older clients simply ignore the field) */
  linkedAccountId?: string;
}

/**
 * A rejected recurring suggestion — the same merchant pattern is never
 * suggested again (synced: a partner's dismissal counts for the space).
 */
export interface RecurringDismissRow extends SyncEnvelope {
  id: string;
  spaceId: string;
  merchantKey: string;
}

/** #148 r3: one row per transaction a signed-in user FIRST saw — synced
 *  through the user's private state space so the 24h "new" clock agrees
 *  across their devices. `spaceId` is the state space; `forSpaceId` the
 *  space the transaction lives in. The per-space baseline row (its id
 *  from `txSeenBaseId`) marks when the scheme started: rows older than
 *  it are known without a row of their own. */
export interface TxSeenRow extends SyncEnvelope {
  id: string;
  spaceId: string;
  forSpaceId: string;
  txId?: string;
  /** ms — when the badge clock started (0 on the baseline row) */
  labeledAt: number;
  baseline?: 0 | 1;
}

export type BudgetEvery = 'week' | '2weeks' | 'month';
export type BudgetCarryMode = 'periods' | 'cap';

/**
 * A space-scoped spending limit over one or more categories, resetting
 * on its own cadence (anchored at a date, independent of the space
 * period). Spending and carry-over are computed client-side from the
 * space's transactions — carry-over is replayed, never stored, so
 * devices always converge (budgets design doc).
 */
export interface BudgetRow extends SyncEnvelope {
  id: string;
  spaceId: string;
  name: string;
  /** MDI icon */
  icon?: string;
  /** the limit per period, positive minor units */
  amountCents: number;
  every: BudgetEvery;
  /** yyyy-mm-dd the cycle counts from */
  anchor: string;
  /** main and/or sub category ids; exclusive across a space's budgets */
  catIds: string[];
  carryOver?: 0 | 1;
  carryMode?: BudgetCarryMode;
  /** carry unused money at most N periods forward (carryMode 'periods') */
  carryPeriods?: number;
  /** or accumulate up to this cap (carryMode 'cap') */
  carryCapCents?: number;
  /** warn when spending crosses this percentage; absent = quiet */
  notifyAtPct?: number;
  active: 0 | 1;
}

/**
 * An event groups transactions around a real-world happening (holiday,
 * wedding, move) to answer what it truly cost. Space-scoped; archiving
 * is manual (approved events design).
 */
export interface EventRow extends SyncEnvelope {
  id: string;
  spaceId: string;
  name: string;
  icon?: string;
  /** bundled asset path ('/events/beach.jpg') or a downscaled data URL */
  picture?: string;
  note?: string;
  color?: string;
  /** optional date range (yyyy-mm-dd) */
  from?: string;
  to?: string;
  /** optional planning number */
  budgetCents?: number;
  archived?: 0 | 1;
}

/**
 * A goal partitions the space's SAVINGS BALANCE into named envelopes
 * (house, car, buffer). No real money moves and no transactions link —
 * the balance is the only truth; over-allocation is flagged, never
 * auto-fixed (approved goals design).
 */
export interface GoalRow extends SyncEnvelope {
  id: string;
  spaceId: string;
  name: string;
  icon?: string;
  color?: string;
  /** cover image like events: bundled path or uploaded data url */
  picture?: string;
  targetCents: number;
  targetDate?: string;
  /** running total, maintained by contributions */
  allocatedCents: number;
  archived?: 0 | 1;
}

/** audit trail of goal funding — separate rows converge without LWW fights */
export interface GoalContributionRow extends SyncEnvelope {
  id: string;
  spaceId: string;
  goalId: string;
  /** + fund / − withdraw (back to unallocated) */
  amountCents: number;
  date: string;
  note?: string;
}

/**
 * DEPRECATED (loans v2, 2026-08-01): debts fold into their liability
 * account at boot (foldDebtsIntoAccounts) — the account row is the one
 * object now. The table stays registered so old devices' rows still
 * sync in and get folded; nothing reads it for display anymore.
 */
export interface DebtRow extends SyncEnvelope {
  id: string;
  spaceId: string;
  name: string;
  icon?: string;
  /** liability account whose balance is the remaining truth */
  accountId?: string;
  /** starting size — optional since the merged Loan form (arc 3): the
   *  current value is the truth anchor, the original only adds progress */
  originalCents?: number;
  /** manual remaining when no account is linked */
  remainingCents?: number;
  /** informational APR, e.g. 3.5 */
  interestPctYear?: number;
  paymentCents?: number;
  paymentDay?: number;
  /** payment cadence (arc 3), recurring-shaped: every N week/month/year;
   *  absent = monthly, estimates fill the gap when payments exist */
  paymentEvery?: RecurringEvery;
  paymentEveryN?: number;
  /** free-form note (arc 3) */
  note?: string;
  /** auto-link payments by merchant (recurring-style) */
  merchantKey?: string;
  archived?: 0 | 1;
}

/**
 * One allocation cell: what this period assigned to this main category
 * (approved allocation design). Deterministic id — two devices editing
 * the same cell converge by LWW instead of duplicating rows.
 */
export interface AllocationRow extends SyncEnvelope {
  id: string;
  spaceId: string;
  /** yyyy-mm-dd start of the space period the cell belongs to */
  periodStart: string;
  /** main category (subs roll up) */
  catId: string;
  assignedCents: number;
}

export type ReceiptSource = 'photo' | 'ah' | 'jumbo' | 'bol' | 'coolblue' | 'mediamarkt' | 'amazon';

export interface ReceiptItem {
  name: string;
  qty?: number;
  unitCents?: number;
  totalCents: number;
}

/** how a store receipt was paid, when the provider exposes it (R5) */
export interface ReceiptPayment {
  /** provider wording, e.g. 'PIN', 'ideal' */
  method?: string;
  /** last digits of the paying IBAN/PAN — constrains tx matching */
  accountTail?: string;
}

/**
 * A transaction's line-item proof. Receipts v3 (approved redesign):
 * store receipts live ONCE in the owner's personal STORE FEED (the
 * global fetch/dedupe layer); linking snapshots them into a space via
 * `receiptLink`. Photo receipts skip the global layer entirely.
 */
export interface ReceiptRow extends SyncEnvelope {
  id: string;
  /** the owner's store feed (v3) or a viewing space (legacy rows) */
  spaceId: string;
  /** legacy pre-v3 link — new links live on receiptLink rows */
  txId?: string;
  source: ReceiptSource;
  date: string;
  totalCents: number;
  merchant?: string;
  items?: ReceiptItem[];
  /** downscaled data URL (photo path) */
  image?: string;
  /** `{store}:{externalId}` — cross-source dedupe key */
  storeRef?: string;
  /** the connection instance that pulled it (v3) */
  instanceId?: string;
  payment?: ReceiptPayment;
}

export type StoreId = Exclude<ReceiptSource, 'photo'>;

/**
 * DEVICE-ONLY store login state — never synced in plaintext, never on
 * our server (receipts privacy law; E2EE storeSync ferries ciphertext).
 * v3: keyed by INSTANCE id — multiple connections of one store coexist.
 */
export interface StoreConnectionRow {
  /** instance id (uuid; migrated legacy rows use the store name) */
  id: string;
  store: StoreId;
  tokens: Record<string, string>;
  refreshedAt: string;
  status: 'ok' | 'expired';
  /** newest store receipt already ingested (dedupe cursor) */
  lastReceiptId?: string;
  /** provider account identity hash — duplicate-connection detection */
  providerAccountHash?: string;
}

/**
 * SYNCED, secret-free connection-instance metadata. Lives in the
 * owner's personal STORE FEED: every one of their devices renders the
 * instance (name, icon) even before E2EE tokens arrive.
 */
export interface StoreConnRow extends SyncEnvelope {
  id: string; // instance id
  spaceId: string; // the owner's store feed
  store: StoreId;
  displayName: string;
  /** BrandIconPicker result ('brands/….svg' or a logo URL) */
  icon?: string;
  providerAccountHash?: string;
  connectedAt: string;
  /** 'expired' = reconnect needed (mirrored from the device row) */
  status?: 'ok' | 'expired';
}

/**
 * Per-space inclusion of a connection instance (the accountLink
 * analogue): members see included connections and their receipts flow
 * into the space. Carries a name/icon snapshot — members cannot read
 * the owner's store feed.
 */
export interface StoreConnLinkRow extends SyncEnvelope {
  id: string; // `sclink:{spaceId}:{instanceId}`
  spaceId: string;
  instanceId: string;
  store: StoreId;
  displayName: string;
  icon?: string;
  addedByName?: string;
}

/**
 * Per-space receipt↔transaction link (the txMeta analogue) carrying a
 * SNAPSHOT of the receipt payload — rulings 1+2: linked receipts follow
 * the transactions (survive leaving, survive instance removal) because
 * the link needs no read access to the owner's store feed.
 */
export interface ReceiptLinkRow extends SyncEnvelope {
  id: string;
  spaceId: string;
  /** global receipt id; absent for photo-born links */
  receiptId?: string;
  /** absent = the receipt is present in the space but not attached yet */
  txId?: string;
  source: ReceiptSource;
  instanceId?: string;
  date: string;
  totalCents: number;
  merchant?: string;
  items?: ReceiptItem[];
  image?: string;
  payment?: ReceiptPayment;
  /** 1 = the matcher linked it, 0/absent = a human did */
  auto?: 0 | 1;
}

/**
 * SYNCED, secret-free connection marker (ruling #1 softener): the space
 * remembers a store was connected, so a device without a local token
 * shows "reconnect on this device" instead of silently doing nothing.
 */
export interface StoreMarkerRow extends SyncEnvelope {
  id: string;
  spaceId: string;
  store: Exclude<ReceiptSource, 'photo'>;
  status: 'connected' | 'expired';
  connectedAt: string;
}

export type AssetClass = 'stock' | 'etf' | 'crypto' | 'cash' | 'other';
export type PriceSource = 'yahoo' | 'coingecko' | 'manual';

/** A portfolio position's identity (approved investments design). */
export interface HoldingRow extends SyncEnvelope {
  id: string;
  spaceId: string;
  /** the brokerage account it lives in (optional) */
  accountId?: string;
  name: string;
  symbol?: string;
  isin?: string;
  assetClass: AssetClass;
  currency: string;
  priceSource?: PriceSource;
  /** yahoo ticker or coingecko coin id, depending on priceSource */
  priceKey?: string;
  /** for unlisted/manual assets — the user's own valuation per unit */
  manualPriceCents?: number;
  archived?: 0 | 1;
}

/** The audit trail behind a holding: buys, sells, dividends, fees. */
export interface LotRow extends SyncEnvelope {
  id: string;
  spaceId: string;
  holdingId: string;
  kind: 'buy' | 'sell' | 'dividend' | 'fee';
  date: string;
  /** units moved (buy/sell) */
  quantity?: number;
  /** per-unit price in cents (buy/sell) */
  priceCents?: number;
  /** signed total in cents: buys negative cash, sells/dividends positive */
  totalCents: number;
}

/**
 * SYNCED insight dismissal (insights ruling #1): an insight is about
 * the space's money — dismissed once, dismissed for every member. The
 * insight id encodes its subject, so a changed situation resurfaces.
 */
export interface InsightDismissRow extends SyncEnvelope {
  id: string;
  spaceId: string;
  insightId: string;
}

/** custom grouping of MAIN categories on the allocate screen ("Fun" =
 * entertainment + coffee + …) — synced, per space */
export interface TopicRow extends SyncEnvelope {
  id: string;
  spaceId: string;
  name: string;
  catIds: string[];
}

/** DEVICE-ONLY delayed-quote cache — prices are never synced data. */
export interface QuoteCacheRow {
  /** `{source}:{priceKey}` */
  key: string;
  price: number;
  currency: string;
  dayChangePct?: number;
  at: string;
}

/**
 * Attachment of a financial account (its feed space) to a viewing
 * space. Lives in the viewing space so members render it offline; the
 * server keeps the authoritative copy for feed access control.
 */
export interface AccountLinkRow extends SyncEnvelope {
  id: string;
  /** the space the account is attached to */
  spaceId: string;
  /** feed space carrying the raw account + transactions */
  feedSpaceId: string;
  /** account entity id inside the feed */
  accountId: string;
  /** user who attached it (their display name frozen for offline rendering) */
  attachedBy?: string;
  attachedByName?: string;
  /** transactions before this date stay hidden in this space */
  historyFrom?: string;
  /** #152: the SPACE-LEVEL account type — the attachment's opinion; a
   *  global account has no type of its own anymore, each space decides
   *  at attach time (absent on old links = the account row's value) */
  type?: AccountType;
  /** #239: the SPACE-LEVEL display name — this space's own name for the
   *  account; absent = the global account name shows */
  displayName?: string;
  /** owner left the space: history stays, no new data flows */
  archived?: 0 | 1;
}

/** Local-only queue of ops not yet accepted by the server. */
export interface OutboxRow {
  opId: string;
  spaceId: string;
  entity: EntityName;
  entityId: string;
  fields: Record<string, unknown>;
  hlc: string;
  deleted?: boolean;
}

/** Local-only key-value store (schema flags, sync cursors, seed markers). */
export interface MetaRow {
  key: string;
  value: unknown;
}

/** one line of "who did what" — capped at the newest 200 per space */
export interface ActivityRow extends SyncEnvelope {
  id: string;
  spaceId: string;
  /** what happened (translated client-side): review | note | txAdd | attach | detach | budgetAdd | accountAdd */
  kind: string;
  /** display name frozen at write time so offline devices can render it */
  actorName?: string;
  /** OIDC sub of the actor (user identities) — lets devices render "You" */
  actorSub?: string;
  /** free-form context: tx title, account name, budget name … */
  detail?: string;
  /** ISO datetime of the action */
  at: string;
}

export type EntityName =
  | 'space'
  | 'account'
  | 'category'
  | 'transaction'
  | 'txMeta'
  | 'accountLink'
  | 'recurring'
  | 'recurringDismiss'
  | 'txSeen'
  | 'budget'
  | 'event'
  | 'goal'
  | 'goalContribution'
  | 'debt'
  | 'allocation'
  | 'receipt'
  | 'receiptLink'
  | 'storeMarker'
  | 'storeConn'
  | 'storeConnLink'
  | 'holding'
  | 'lot'
  | 'insightDismiss'
  | 'topic'
  | 'activity';

export interface EntityRowMap {
  space: SpaceRow;
  account: AccountRow;
  category: CategoryRow;
  transaction: TransactionRow;
  txMeta: TxMetaRow;
  accountLink: AccountLinkRow;
  recurring: RecurringRow;
  recurringDismiss: RecurringDismissRow;
  txSeen: TxSeenRow;
  budget: BudgetRow;
  event: EventRow;
  goal: GoalRow;
  goalContribution: GoalContributionRow;
  debt: DebtRow;
  allocation: AllocationRow;
  receipt: ReceiptRow;
  receiptLink: ReceiptLinkRow;
  storeMarker: StoreMarkerRow;
  storeConn: StoreConnRow;
  storeConnLink: StoreConnLinkRow;
  holding: HoldingRow;
  lot: LotRow;
  insightDismiss: InsightDismissRow;
  topic: TopicRow;
  activity: ActivityRow;
}
