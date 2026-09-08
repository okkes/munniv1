/**
 * #192 (user): debt detection, recurring-style — a detected payment
 * pattern whose creditor is a KNOWN lender reads as a loan, not a
 * subscription. The seed list starts with DUO (Dienst Uitvoering
 * Onderwijs, the Dutch student-loan agency) per the user's example;
 * matching is word-bounded so "Duolingo" never reads as student debt.
 */
const DEBT_CREDITOR_PATTERNS: readonly RegExp[] = [
  /\bduo\b/i,
  /dienst\s+uitvoering\s+onderwijs/i,
];

export const looksLikeDebtCreditor = (name: string): boolean =>
  DEBT_CREDITOR_PATTERNS.some((pattern) => pattern.test(name));
