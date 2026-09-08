import type { EntityName } from './types';

/**
 * Model-level data invariants, enforced at the ONE local write path
 * (Repo.write) so no screen can slip malformed rows past its own input
 * validation into the database (user request 2026-07-28, the
 * FluentValidation idea). A violation blocks the write and reaches
 * GlitchTip — it means a UI-level check is missing somewhere.
 *
 * Remote ops are deliberately NOT validated: LWW convergence must never
 * be refused client-side, and rows written before a rule existed keep
 * syncing. The rules run where the data is born.
 */
export class InvariantViolation extends Error {
  constructor(entity: EntityName, entityId: string, problems: readonly string[]) {
    super(`${entity}/${entityId}: ${problems.join('; ')}`);
    this.name = 'InvariantViolation';
  }
}

const TX_TYPES = new Set(['income', 'expense', 'saving', 'transfer', 'debtPayment', 'investment', 'funding', 'adjustment']);
const ISO_DAY = /^\d{4}-\d{2}-\d{2}$/;

const isIntCents = (v: unknown): v is number => typeof v === 'number' && Number.isSafeInteger(v);

function amountAndTypeProblems(row: Record<string, unknown>): string[] {
  const problems: string[] = [];
  if (!isIntCents(row.amountCents)) problems.push('amountCents must be integer cents');
  if (typeof row.date !== 'string' || !ISO_DAY.test(row.date)) problems.push('date must be ISO yyyy-mm-dd');
  const hasType = row.txType !== undefined && row.txType !== null;
  if (hasType && !(typeof row.txType === 'string' && TX_TYPES.has(row.txType))) problems.push('unknown txType');
  // sign-bound types: a standard row's type follows its sign (the
  // pre-2026-07-28 bulk-apply wrote +€1000 rows as 'expense')
  if (isIntCents(row.amountCents) && row.amountCents !== 0) {
    if (row.txType === 'expense' && row.amountCents > 0) problems.push('positive amount typed expense');
    if (row.txType === 'income' && row.amountCents < 0) problems.push('negative amount typed income');
  }
  return problems;
}

function splitProblems(splits: { catId?: unknown; amountCents?: unknown }[]): string[] {
  const problems: string[] = [];
  for (const split of splits) {
    if (typeof split.catId !== 'string' || split.catId.length === 0) problems.push('split without a category');
    if (!isIntCents(split.amountCents) || split.amountCents < 0) problems.push('split amount must be non-negative integer cents');
  }
  return problems;
}

function reimbursementProblems(links: { txId?: unknown; amountCents?: unknown }[]): string[] {
  const problems: string[] = [];
  for (const link of links) {
    if (typeof link.txId !== 'string' || link.txId.length === 0) problems.push('reimbursement without a counterpart');
    if (!isIntCents(link.amountCents) || link.amountCents <= 0) problems.push('reimbursement amount must be positive integer cents');
  }
  return problems;
}

function transactionProblems(row: Record<string, unknown>): string[] {
  const reviewFlagOk = row.needsReview === undefined || row.needsReview === 0 || row.needsReview === 1;
  return [
    ...amountAndTypeProblems(row),
    ...splitProblems((row.splits as { catId?: unknown; amountCents?: unknown }[] | null | undefined) ?? []),
    ...reimbursementProblems((row.reimbursements as { txId?: unknown; amountCents?: unknown }[] | null | undefined) ?? []),
    ...(reviewFlagOk ? [] : ['needsReview must be 0 or 1']),
  ];
}

function namedRowProblems(row: Record<string, unknown>): string[] {
  // live rows need a usable name; tombstones keep whatever they had
  if (row.deleted !== 0) return [];
  return typeof row.name === 'string' && row.name.trim().length > 0 ? [] : ['live row without a name'];
}

/**
 * Returns the violated rules for a merged row about to be written, empty
 * when the row is sound. Unknown entities always pass — rules are opt-in
 * per table, strongest where the money lives.
 */
export function rowProblems(entity: EntityName, row: Record<string, unknown>): string[] {
  if (typeof row.id !== 'string' || row.id.length === 0) return ['row without an id'];
  switch (entity) {
    case 'transaction':
      return transactionProblems(row);
    case 'space':
    case 'category':
      return namedRowProblems(row);
    default:
      return [];
  }
}
