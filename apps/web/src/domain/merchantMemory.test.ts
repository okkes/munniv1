import { describe, expect, it } from 'vitest';
import { merchantKey } from './merchantKey';
import { buildMerchantMemory, predictFromMemory } from './merchantMemory';
import type { MemoryInput } from './merchantMemory';
import { predictTx, predictionSkipsReview } from './predictCategory';

const confirmed = (over: Partial<MemoryInput>): MemoryInput => ({
  merchant: 'Albert Heijn 1470',
  catId: 'groceries',
  txType: 'expense',
  needsReview: 0,
  date: '2026-06-01',
  amountCents: -2500,
  ...over,
});

describe('merchantKey', () => {
  it('strips processor prefixes, store numbers and punctuation', () => {
    expect(merchantKey('CCV*ALBERT HEIJN 1470 AMS')).toBe('albert heijn ams');
    expect(merchantKey('Albert Heijn 1470')).toBe('albert heijn');
    expect(merchantKey('Zettle_*Bakkerij Jansen')).toBe('bakkerij jansen');
    expect(merchantKey('PayPal *NETFLIX.COM')).toBe('netflix com');
  });

  it('keeps single digits inside brand names', () => {
    expect(merchantKey('Kruidvat 2go')).toContain('2go');
  });

  it('drops trailing branch cities and dates so branches group (user request)', () => {
    expect(merchantKey('Albert Heijn 10-04-2026')).toBe('albert heijn');
    expect(merchantKey('Albert Heijn 12-04-2026')).toBe('albert heijn');
    expect(merchantKey('AH DELFT')).toBe('ah');
    expect(merchantKey("JUMBO 'S-GRAVENHAGE")).toBe('jumbo');
    expect(merchantKey('Restaurant Den Haag')).toBe('restaurant');
    // a merchant that IS a city name keeps its identity
    expect(merchantKey('Delft')).toBe('delft');
  });
});

describe('merchant memory', () => {
  it('learns only from human-confirmed rows', () => {
    const memory = buildMerchantMemory([
      confirmed({}),
      confirmed({ needsReview: 1, catId: 'restaurants' }), // unreviewed guess — ignored
      confirmed({ catId: undefined }), // uncategorized — ignored
    ]);
    const hit = predictFromMemory(memory, 'Albert Heijn 2201', -1800);
    expect(hit?.catId).toBe('groceries');
    expect(hit?.evidence).toBe(1);
  });

  it('the latest opinion wins over an older majority (user corrections stick)', () => {
    const memory = buildMerchantMemory([
      confirmed({ date: '2026-01-05' }),
      confirmed({ date: '2026-01-12' }),
      confirmed({ date: '2026-01-19' }),
      confirmed({ date: '2026-06-20', catId: 'sport' }), // deliberate re-categorization
    ]);
    expect(predictFromMemory(memory, 'Albert Heijn', -2000)?.catId).toBe('sport');
  });

  it('a same-amount occurrence beats recency (subscription behavior)', () => {
    const memory = buildMerchantMemory([
      confirmed({ merchant: 'Bol.com', catId: 'shopping', date: '2026-06-01', amountCents: -4599 }),
      confirmed({ merchant: 'Bol.com', catId: 'subs', date: '2026-01-01', amountCents: -999 }),
    ]);
    expect(predictFromMemory(memory, 'Bol.com', -999)?.catId).toBe('subs');
    expect(predictFromMemory(memory, 'Bol.com', -999)?.amountMatch).toBe(true);
  });

  it('refunds do not inherit purchase categories (sign separation)', () => {
    const memory = buildMerchantMemory([confirmed({})]);
    expect(predictFromMemory(memory, 'Albert Heijn', +2500)).toBeNull();
  });
});

describe('predictTx layering', () => {
  it('history beats keywords, keywords cover cold start', () => {
    const memory = buildMerchantMemory([
      confirmed({ merchant: 'Albert Heijn', catId: 'sport', txType: 'expense' }),
      confirmed({ merchant: 'Albert Heijn', catId: 'sport', txType: 'expense', date: '2026-06-10' }),
    ]);
    // "albert heijn" is also a groceries KEYWORD — history must win
    const history = predictTx({ memory, merchant: 'Albert Heijn 1470', amountCents: -1500 });
    expect(history?.catId).toBe('sport');
    expect(history?.source).toBe('history');
    expect(predictionSkipsReview(history)).toBe(true);

    const cold = predictTx({ memory: buildMerchantMemory([]), merchant: 'Albert Heijn', amountCents: -1500 });
    expect(cold?.source).toBe('keyword');
    expect(predictionSkipsReview(cold)).toBe(false); // keyword guesses go to review
  });

  it('single-occurrence history predicts but does not skip review', () => {
    const memory = buildMerchantMemory([confirmed({ merchant: 'Padelbaan Zuid', catId: 'sport' })]);
    const p = predictTx({ memory, merchant: 'Padelbaan Zuid', amountCents: -1200 });
    expect(p?.catId).toBe('sport');
    expect(predictionSkipsReview(p)).toBe(false);
  });
});
