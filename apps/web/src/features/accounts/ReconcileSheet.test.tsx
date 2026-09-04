// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { DexieBackend } from '@/db/backend';
import { MunniDB } from '@/db/schema';
import { Repo } from '@/db/repo';
import { HlcClock } from '@/sync/hlc';
import { renderWithData } from '@/test/harness';
import { ReconcileSheet } from './ReconcileSheet';

const FEED = 'feed-ui';

/** the imported/linked pair the sheet judges — a match and a mismatch */
async function seedPair() {
  const db = new MunniDB('munni_demo');
  const repo = new Repo(new DexieBackend(db), new HlcClock('rec-ui'), { trackOutbox: false });
  await repo.upsert('space', FEED, FEED, { name: 'feed', kind: 'personal', currency: 'EUR', periodType: 'month' });
  const raw = { accountId: 'acct-ui', currency: 'EUR', txType: 'expense' as const, needsReview: 0 as const };
  // flanking bank rows — the coverage's edges are exclusive
  await repo.upsert('transaction', FEED, 'LU0', { ...raw, date: '2026-06-01', amountCents: -100, merchant: 'X', importRef: 'REF-U0' });
  await repo.upsert('transaction', FEED, 'LU9', { ...raw, date: '2026-06-20', amountCents: -200, merchant: 'Y', importRef: 'REF-U9' });
  await repo.upsert('transaction', FEED, 'LU1', { ...raw, date: '2026-06-10', amountCents: -1200, merchant: 'SHELL', importRef: 'REF-U1' });
  await repo.upsert('transaction', FEED, 'IU1', { ...raw, date: '2026-06-10', amountCents: -1200, merchant: 'Shell station', importRef: 'ing:u:1' });
  await repo.upsert('transaction', FEED, 'IU2', { ...raw, date: '2026-06-12', amountCents: -999, merchant: 'GHOST', importRef: 'ing:u:2' });
  return db;
}

describe('ReconcileSheet (#311 r2)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });

  it('folded matches open to labeled PAIRS, and confirm actually deletes (the “nothing happens” walk)', async () => {
    const db = await seedPair();
    renderWithData(<ReconcileSheet open onOpenChange={() => undefined} accountIds={['acct-ui']} />);
    // #311 r3: the QUESTION comes first — nothing auto-matches; the
    // list only shows after an explicit yes
    fireEvent.click(await screen.findByTestId('reconcile-ask-go', {}, { timeout: 10_000 }));
    await screen.findByTestId('reconcile-review', {}, { timeout: 10_000 });

    // #311 r2: the match list starts FOLDED — the mismatch section is
    // in reach without scrolling; the toggle opens it
    expect(screen.queryByTestId('reconcile-match-IU1')).toBeNull();
    await screen.findByTestId('reconcile-mismatch-IU2');
    fireEvent.click(screen.getByTestId('reconcile-matches-toggle'));
    const match = await screen.findByTestId('reconcile-match-IU1');
    // both halves of the pair, labeled — the import AND the bank row
    expect(match.textContent).toContain('Imported file');
    expect(match.textContent).toContain('From the bank');
    expect(match.textContent).toContain('Shell station');
    expect(match.textContent).toContain('SHELL');

    fireEvent.click(screen.getByTestId('reconcile-confirm'));
    await screen.findByTestId('reconcile-done', {}, { timeout: 10_000 });
    await waitFor(async () => {
      expect((await db.transactions.get('IU1'))?.deleted).toBe(1);
      expect((await db.transactions.get('IU2'))?.deleted).toBe(1);
      expect((await db.transactions.get('LU1'))?.deleted).toBe(0);
    }, { timeout: 10_000 });
    db.close();
  }, 30_000);
});
