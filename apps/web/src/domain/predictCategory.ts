import { CATEGORY_BY_ID } from './categories';
import { KEYWORD_RULES } from './keyword-categories';
import type { KeywordRule } from './keyword-categories';
import { predictFromMemory } from './merchantMemory';
import type { MerchantMemory } from './merchantMemory';
import { kindOf } from './txKind';
import type { TxType } from '@/db/types';

/**
 * Keyword-based category prediction for imported bank transactions, ported
 * from apollousa's CategoryByKeyWordPredictor. Runs fully on-device so
 * import works offline.
 *
 * Long keywords (>3 chars) match as substrings; short ones must match a
 * whole word. Longest keyword wins. Rules are filtered by money direction
 * so e.g. income keywords never fire on a debit.
 */
/**
 * Country of use → keyword language (onboarding asks for it so imports
 * of local merchants predict better). Only Dutch keyword sets exist
 * today; unknown countries fall back to them rather than to nothing —
 * new locales slot in here as their keyword files land.
 */
const COUNTRY_KEYWORD_LANG: Record<string, string> = { NL: 'nl', BE: 'nl' };
const FALLBACK_KEYWORD_LANG = 'nl';

let activeRules: readonly KeywordRule[] = KEYWORD_RULES;

/** hydrate from the stored profile at app open + when onboarding saves */
export function setPredictionCountry(country?: string): void {
  const keywordLang = COUNTRY_KEYWORD_LANG[country?.toUpperCase() ?? ''] ?? FALLBACK_KEYWORD_LANG;
  const filtered = KEYWORD_RULES.filter((r) => r.lang === keywordLang);
  activeRules = filtered.length ? filtered : KEYWORD_RULES.filter((r) => r.lang === FALLBACK_KEYWORD_LANG);
}

export function predictCategory(
  text: string,
  direction: 'credit' | 'debit',
  rules: readonly { catId: string; keywords: string[] }[] = activeRules,
  catById: { get: (id: string) => { direction: 'credit' | 'debit' | 'both' } | undefined } = CATEGORY_BY_ID,
): string | null {
  const haystack = text.toLowerCase();
  const words = new Set(haystack.split(/\s+/));

  const candidates: { keyword: string; catId: string }[] = [];
  for (const rule of rules) {
    const cat = catById.get(rule.catId);
    if (!cat) continue;
    if (cat.direction !== 'both' && cat.direction !== direction) continue;
    for (const keyword of rule.keywords) candidates.push({ keyword, catId: rule.catId });
  }
  candidates.sort((a, b) => b.keyword.length - a.keyword.length);

  for (const { keyword, catId } of candidates) {
    const hit = keyword.length > 3 ? haystack.includes(keyword) : words.has(keyword);
    if (hit) return catId;
  }
  return null;
}

export interface TxPrediction {
  catId: string;
  txType: TxType;
  source: 'history' | 'history-amount' | 'keyword';
  /** history occurrences backing the prediction (history sources only) */
  evidence?: number;
  /** #161: the pct spread the user keeps confirming (own space only) */
  cats?: { catId: string; pct: number }[];
  /** #161: the event the recent charges joined (own space only) */
  eventId?: string;
}

/** #161: the own space answers first, other spaces are the fallback */
export interface LayeredMemory {
  own: MerchantMemory;
  others: MerchantMemory;
}

export interface PredictInput {
  memory?: LayeredMemory;
  merchant: string;
  /** the user's rename — keyword matching reads it too (user request) */
  titleOverride?: string;
  description?: string;
  amountCents: number;
  /** operator-published keyword rules (catalog document) — merged in
   *  front of the bundled set, so they win ties without erasing it */
  keywordRules?: readonly { catId: string; keywords: string[] }[];
}

/**
 * Layered prediction: the user's own history for this merchant first
 * (same-amount occurrences boosted — subscription behavior), keyword
 * rules as the cold-start fallback. History also carries the learned
 * transaction TYPE (a DEGIRO transfer the user marked as saving stays
 * saving), keywords derive it from the category.
 */
/** a learned STANDARD type never overrules the row's sign: the same
 *  counterparty is an expense when you pay them and income when they
 *  pay you (user ss 2026-08-01: a +€2,000 credit predicted 'expense'
 *  from outgoing history). Transfer-family types carry meaning on both
 *  signs and pass through. */
function signSafeType(txType: TxType, amountCents: number): TxType {
  if (kindOf(txType) !== 'standard') return txType;
  return amountCents >= 0 ? 'income' : 'expense';
}

/** #161: the memory's answer, own space first (S3776: out of predictTx) */
function memoryPrediction(memory: LayeredMemory, input: PredictInput): TxPrediction | null {
  const hit =
    predictFromMemory(memory.own, input.merchant, input.amountCents) ??
    predictFromMemory(memory.others, input.merchant, input.amountCents);
  if (!hit) return null;
  return {
    catId: hit.catId,
    txType: signSafeType(hit.txType, input.amountCents),
    source: hit.amountMatch ? 'history-amount' : 'history',
    evidence: hit.evidence,
    ...(hit.cats ? { cats: hit.cats } : {}),
    ...(hit.eventId ? { eventId: hit.eventId } : {}),
  };
}

export function predictTx(input: PredictInput): TxPrediction | null {
  if (input.memory) {
    const remembered = memoryPrediction(input.memory, input);
    if (remembered) return remembered;
  }
  const direction = input.amountCents >= 0 ? 'credit' : 'debit';
  const catId = predictCategory(
    `${input.merchant} ${input.titleOverride ?? ''} ${input.description ?? ''}`,
    direction,
    input.keywordRules ? [...input.keywordRules, ...activeRules] : activeRules,
  );
  if (!catId) return null;
  const txType = CATEGORY_BY_ID.get(catId)?.txTypes[0] ?? (direction === 'credit' ? 'income' : 'expense');
  return { catId, txType: signSafeType(txType, input.amountCents), source: 'keyword' };
}

/**
 * Only predictions the user effectively taught the app skip review:
 * a merchant they confirmed at least twice. Keyword hits and first-time
 * history are applied but flagged — review is the teaching loop.
 */
export const predictionSkipsReview = (prediction: TxPrediction | null): boolean =>
  prediction !== null && prediction.source !== 'keyword' && (prediction.evidence ?? 0) >= 2;
