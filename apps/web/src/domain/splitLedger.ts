/**
 * Split-session ledger math (settleup-splits SP1). Pure: entries in,
 * net positions and a minimal transfer plan out.
 *
 * One formula covers both kinds: whoever PAID an entry is owed its full
 * amount, every share holder owes their slice. A settlement is simply
 * an entry whose only share holder is the receiver — recording "A paid
 * B €x" moves both nets by x with no special casing.
 */

export interface LedgerShare {
  userId: string;
  cents: number;
}

export interface LedgerEntry {
  paidByUserId: string;
  amountCents: number;
  shares: LedgerShare[];
}

/** userId → net cents: positive = the group owes them, negative = they owe */
export function netPositions(entries: readonly LedgerEntry[], memberIds: readonly string[]): Map<string, number> {
  const nets = new Map<string, number>(memberIds.map((id) => [id, 0]));
  for (const entry of entries) {
    nets.set(entry.paidByUserId, (nets.get(entry.paidByUserId) ?? 0) + entry.amountCents);
    for (const share of entry.shares) {
      nets.set(share.userId, (nets.get(share.userId) ?? 0) - share.cents);
    }
  }
  return nets;
}

export interface Transfer {
  fromUserId: string;
  toUserId: string;
  cents: number;
}

/**
 * Greedy netting: repeatedly match the largest debtor with the largest
 * creditor. Produces at most (n − 1) transfers and is deterministic
 * (ties broken by userId) so every member computes the same plan.
 */
export function settlementPlan(nets: ReadonlyMap<string, number>): Transfer[] {
  const debtors = [...nets.entries()].filter(([, cents]) => cents < 0).map(([id, cents]) => ({ id, open: -cents }));
  const creditors = [...nets.entries()].filter(([, cents]) => cents > 0).map(([id, cents]) => ({ id, open: cents }));
  const byOpen = (a: { open: number; id: string }, b: { open: number; id: string }) =>
    b.open - a.open || a.id.localeCompare(b.id);

  const transfers: Transfer[] = [];
  while (debtors.length > 0 && creditors.length > 0) {
    debtors.sort(byOpen);
    creditors.sort(byOpen);
    const debtor = debtors[0];
    const creditor = creditors[0];
    const cents = Math.min(debtor.open, creditor.open);
    transfers.push({ fromUserId: debtor.id, toUserId: creditor.id, cents });
    debtor.open -= cents;
    creditor.open -= cents;
    if (debtor.open === 0) debtors.shift();
    if (creditor.open === 0) creditors.shift();
  }
  return transfers;
}
