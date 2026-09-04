import { describe, expect, it } from 'vitest';
import { predictCategory, predictTx } from './predictCategory';
import { KEYWORD_RULES } from './keyword-categories';
import { CATEGORY_BY_ID } from './categories';
import { buildMerchantMemory } from './merchantMemory';
import type { MemoryInput } from './merchantMemory';

describe('predictCategory', () => {
  it('long keywords match as substrings, case-insensitive', () => {
    expect(predictCategory('ALBERT HEIJN 1350 AMSTERDAM', 'debit')).toBe('groceries');
    expect(predictCategory('betaling albert heijn', 'debit')).toBe('groceries');
  });

  it('short keywords (<=3 chars) must match a whole word', () => {
    // 'gvb' (public transport) fires as a word, never inside another word
    expect(predictCategory('gvb amsterdam', 'debit')).toBe('transportPublic');
    expect(predictCategory('MEGAGVBSTORE', 'debit')).not.toBe('transportPublic');
  });

  it('direction filters rules (income keywords never fire on debits)', () => {
    expect(predictCategory('salaris juni', 'credit')).toBe('salary');
    expect(predictCategory('salaris juni', 'debit')).not.toBe('salary');
  });

  it('longest keyword wins over shorter overlapping ones', () => {
    // construct text hitting both a long and a short rule; long is checked first
    const withLong = predictCategory('albert heijn to go', 'debit');
    expect(withLong).toBe('groceries');
  });

  it('returns null when nothing matches', () => {
    expect(predictCategory('xqzzy unmatched merchant', 'debit')).toBeNull();
    expect(predictCategory('', 'credit')).toBeNull();
  });

  it('every rule points at an existing catalog category (generated data integrity)', () => {
    for (const rule of KEYWORD_RULES) {
      expect(CATEGORY_BY_ID.get(rule.catId), rule.catId).toBeTruthy();
      expect(rule.keywords.length).toBeGreaterThan(0);
    }
  });

  it('a learned STANDARD type never overrules the sign (user ss: +€2,000 predicted expense)', () => {
    const paid = (over: Partial<MemoryInput>): MemoryInput => ({
      merchant: 'Mw C Sahin', catId: 'groceries', txType: 'expense', needsReview: 0, date: '2026-06-01', amountCents: -2_000_00, ...over,
    });
    // the corruption loop this guards against: POSITIVE rows once
    // confirmed as expense through the overlay (txMeta skips the sign
    // invariant), memory re-learning them, imports re-predicting the
    // contradiction forever. The prediction now follows the sign.
    const layered = (own: ReturnType<typeof buildMerchantMemory>) => ({ own, others: buildMerchantMemory([]) });
    const memory = buildMerchantMemory([
      paid({ amountCents: 2_000_00 }),
      paid({ date: '2026-07-01', amountCents: 2_000_00 }),
    ]);
    const hit = predictTx({ memory: layered(memory), merchant: 'Mw C Sahin', amountCents: 2_000_00 });
    expect(hit?.source).toBe('history-amount'); // the memory DID answer…
    expect(hit?.txType).toBe('income'); // …but the sign owns the type
    // transfer-family learned types keep their meaning untouched
    const savings = buildMerchantMemory([
      paid({ merchant: 'DEGIRO', catId: 'investBuy', txType: 'investment', amountCents: -100_00 }),
      paid({ merchant: 'DEGIRO', catId: 'investBuy', txType: 'investment', date: '2026-07-01', amountCents: -100_00 }),
    ]);
    expect(predictTx({ memory: layered(savings), merchant: 'DEGIRO', amountCents: -100_00 })?.txType).toBe('investment');
  });
});
