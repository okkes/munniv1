import { normalizeIban } from './feedIds';
import { merchantKey } from './merchantKey';

/**
 * PayPal funding detection + pair matching (PP1, approved design).
 *
 * A purchase paid via PayPal from a bank account appears TWICE: as a
 * debit on the funding account (creditor "PayPal (Europe) S.a.r.l. et
 * Cie, S.C.A.", a SHARED collection IBAN — the same for every PayPal
 * customer, so it never identifies the user's own PayPal account) and
 * as the real transaction inside the PayPal feed. The approved rule:
 * count once, on the PayPal side — the bank debit becomes a transfer to
 * the PayPal account. Works for ANY funding account (user ruling: ING
 * was only the example).
 */

/** PayPal Europe's known SEPA collection IBANs (shared across customers) */
const PAYPAL_COLLECTION_IBANS = new Set(['LU89751000135104200E', 'LU096375100013510420']);

const PAYPAL_NAME = /\bpay\s?pal\b/i;

/** does this bank-side row look like money flowing to/from PayPal? */
export function isPaypalFunding(tx: { merchant: string; counterIban?: string; description?: string }): boolean {
  if (PAYPAL_NAME.test(tx.merchant)) return true;
  if (tx.counterIban && PAYPAL_COLLECTION_IBANS.has(normalizeIban(tx.counterIban))) return true;
  return false;
}

/** is this account the user's PayPal feed? (GoCardless institution or name) */
export function isPaypalAccount(account: { name: string; bankId?: string }): boolean {
  return PAYPAL_NAME.test(account.name) || /paypal/i.test(account.bankId ?? '');
}

const DAY_MS = 86_400_000;
const dayDistance = (a: string, b: string): number => Math.abs(Date.parse(a) - Date.parse(b)) / DAY_MS;

export interface PaypalPairInput {
  id: string;
  date: string;
  amountCents: number;
  merchant: string;
  description?: string;
}

/**
 * Pair bank-side PayPal debits with the PayPal-feed transactions they
 * funded: same absolute amount within the window, nearest date wins, a
 * merchant-token hit in the bank remittance breaks ties. Ambiguity
 * (unresolvable tie) pairs nothing — those rows stay review-gated
 * rather than guessing (rung 3).
 */
export function matchPaypalPairs(
  bankDebits: readonly PaypalPairInput[],
  paypalTxs: readonly PaypalPairInput[],
  windowDays = 3,
): Map<string, string> {
  const pairs = new Map<string, string>(); // bank tx id -> paypal tx id
  const taken = new Set<string>();
  for (const debit of bankDebits) {
    const bankText = `${debit.merchant} ${debit.description ?? ''}`.toLowerCase();
    const candidates = paypalTxs
      .filter(
        (p) =>
          !taken.has(p.id) &&
          Math.abs(p.amountCents) === Math.abs(debit.amountCents) &&
          dayDistance(p.date, debit.date) <= windowDays,
      )
      .sort((a, b) => dayDistance(a.date, debit.date) - dayDistance(b.date, debit.date));
    if (candidates.length === 0) continue;
    let pick = candidates[0];
    if (candidates.length > 1) {
      // several same-amount candidates: only a merchant-token hit decides
      const tokenHits = candidates.filter((p) => bankText.includes(merchantKey(p.merchant)));
      if (tokenHits.length !== 1) continue; // ambiguous — leave for review
      pick = tokenHits[0];
    }
    pairs.set(debit.id, pick.id);
    taken.add(pick.id);
  }
  return pairs;
}
