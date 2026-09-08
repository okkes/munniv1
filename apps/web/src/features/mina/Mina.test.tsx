// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { MunniDB } from '@/db/schema';
import { Repo } from '@/db/repo';
import { DexieBackend } from '@/db/backend';
import { HlcClock } from '@/sync/hlc';
import { MINA_STEPS } from './steps';
import { clipPads, rectSettled } from './MinaTutorial';
import { revertMinaRun } from './revert';
import { en } from '@/i18n/en';
import { nl } from '@/i18n/nl';
import { tr } from '@/i18n/tr';

describe('Mina step registry', () => {
  it('every step key exists in all three languages and shapes are coherent', () => {
    for (const step of MINA_STEPS) {
      for (const [lang, dict] of Object.entries({ en, nl, tr })) {
        expect(dict[step.titleKey], `${lang} ${step.titleKey}`).toBeTruthy();
        expect(dict[step.bodyKey], `${lang} ${step.bodyKey}`).toBeTruthy();
        if (step.suggestKey) expect(dict[step.suggestKey], `${lang} ${step.suggestKey}`).toBeTruthy();
      }
      if (step.kind === 'fullscreen') expect(step.art, step.id).toBeTruthy();
      if (step.gate || step.info) expect(step.anchor?.length, step.id).toBeTruthy();
    }
    // one welcome, one wrap, both fullscreen
    expect(MINA_STEPS[0].id).toBe('welcome');
    expect(MINA_STEPS.at(-1)!.id).toBe('wrap');
  });
});

describe('#136 r3: settled-geometry reveal + sheet-aware clip pads', () => {
  const rect = (top: number, left = 0, width = 100, height = 40) => ({ top, left, width, height }) as DOMRect;

  it('rectSettled: only two agreeing frames count — a sheet mid slide-in never settles', () => {
    // first sighting has no previous frame to agree with
    expect(rectSettled(null, rect(400))).toBe(false);
    // the bottom sheet is still rising — the one-shot reveal must wait
    expect(rectSettled(rect(700), rect(520))).toBe(false);
    // geometry held still for a frame — now the clip check may judge
    expect(rectSettled(rect(520), rect(520))).toBe(true);
    // a size change (desktop dialog growing) is movement too
    expect(rectSettled(rect(520, 0, 100, 40), rect(520, 0, 100, 90))).toBe(false);
  });

  it('clipPads: anchors inside a sheet float above the app chrome — tight pads', () => {
    const sheet = document.createElement('div');
    sheet.setAttribute('data-sheet-body', '');
    const row = document.createElement('button');
    sheet.appendChild(row);
    document.body.appendChild(sheet);
    const bare = document.createElement('button');
    document.body.appendChild(bare);
    try {
      // a sheet's bottom row is NOT hidden behind the tab bar — the
      // sheet covers that chrome, so the chrome-sized pads must not
      // call it "clipped" forever (that buried the switcher's Manage
      // row at sub-lg sizes and stood the soft glow down at sheet
      // bottoms, user ss 2026-08-21)
      expect(clipPads(row)).toEqual([12, 12]);
      // on-screen anchors keep the app-bar/tab-bar reserves
      expect(clipPads(bare)).toEqual([70, 96]);
    } finally {
      sheet.remove();
      bare.remove();
    }
  });
});

describe('revertMinaRun', () => {
  it('sweeps ledgered spaces with contents, tombstones loose rows, leaves the rest', async () => {
    const db = new MunniDB(`mina_revert_${Math.random().toString(36).slice(2)}`);
    const store = new DexieBackend(db);
    const repo = new Repo(store, new HlcClock('mr'), { trackOutbox: false });
    // survivor space with a tutorial-made transaction (loose ledger row)
    await repo.upsert('space', 'keep', 'keep', { name: 'Keep', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await repo.upsert('account', 'keep', 'acc', { name: 'Wallet', type: 'checking', source: 'manual', currency: 'EUR', balanceCents: 0 });
    await repo.upsert('transaction', 'keep', 'tour-tx', { accountId: 'acc', date: '2026-07-26', amountCents: -1234, currency: 'EUR', merchant: 'Groceries', txType: 'expense', needsReview: 0 });
    await repo.upsert('transaction', 'keep', 'own-tx', { accountId: 'acc', date: '2026-07-25', amountCents: -500, currency: 'EUR', merchant: 'Mine', txType: 'expense', needsReview: 0 });
    // ledgered second space with its own content
    await repo.upsert('space', 'fam', 'fam', { name: 'Family', kind: 'personal', currency: 'EUR', periodType: 'month', periodDay: 1 });
    await repo.upsert('account', 'fam', 'fam-acc', { name: 'X', type: 'checking', source: 'manual', currency: 'EUR', balanceCents: 0 });

    await revertMinaRun(store, repo, [
      { entity: 'space', spaceId: 'fam', id: 'fam' },
      { entity: 'transaction', spaceId: 'keep', id: 'tour-tx' },
    ]);

    expect((await db.spaces.get('fam'))?.deleted).toBe(1);
    expect((await db.accounts.get('fam-acc'))?.deleted).toBe(1);
    expect((await db.transactions.get('tour-tx'))?.deleted).toBe(1);
    // untouched: the survivor space, its account, the user's own row
    expect((await db.spaces.get('keep'))?.deleted).toBe(0);
    expect((await db.accounts.get('acc'))?.deleted).toBe(0);
    expect((await db.transactions.get('own-tx'))?.deleted).toBe(0);
    db.close();
  });
});

describe('Mina tutorial run (signed-in identity, no space yet)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  const freshUser = async () => {
    const { USER_TEST_DB, renderAppAsUser } = await import('@/test/harness');
    cleanup(); // the previous app must release the db before deletion
    await new Promise((resolve) => {
      const req = indexedDB.deleteDatabase(USER_TEST_DB);
      req.onsuccess = req.onerror = req.onblocked = () => resolve(undefined);
    });
    renderAppAsUser('/home', { spaces: [] });
    // the REAL hand-off: bootstrap left zero spaces + the pending flag,
    // Home redirects into onboarding, finishing it auto-starts Mina
    const name = await screen.findByTestId('onboarding-name', {}, { timeout: 5000 });
    fireEvent.change(name, { target: { value: 'Tester' } });
    fireEvent.click(screen.getByTestId('onboarding-save'));
    fireEvent.click(await screen.findByTestId('onboarding-lock-later', {}, { timeout: 5000 }));
    return USER_TEST_DB;
  };

  it('walks welcome → concepts → the gated space creation; the act accepts ANY name', async () => {
    const dbName = await freshUser();
    // S1 fullscreen welcome
    const fs1 = await screen.findByTestId('mina-fullscreen', {}, { timeout: 5000 });
    expect(fs1.textContent).toContain(en['mina.welcome.t']);
    fireEvent.click(screen.getByTestId('mina-next')); // → home bubble
    await waitFor(() => expect(screen.getByTestId('mina-tutorial').dataset.step).toBe('home'), { timeout: 5000 });
    // Continue-driven bubbles without a shade still block wandering off
    // (user ss 2026-07-29: everything was tappable on the Home step)
    expect(screen.getByTestId('mina-tap-blocker')).toBeTruthy();
    fireEvent.click(screen.getByTestId('mina-next')); // → spaces concept
    fireEvent.click(await screen.findByTestId('mina-next')); // → sharing
    fireEvent.click(await screen.findByTestId('mina-next')); // → openSwitcher gate
    await waitFor(() => expect(screen.getByTestId('mina-tutorial').dataset.step).toBe('openSwitcher'), { timeout: 5000 });

    // gated walk: switcher → manage → + (real elements, real clicks)
    fireEvent.click(await screen.findByTestId('home-space-switcher', {}, { timeout: 5000 }));
    await waitFor(() => expect(screen.getByTestId('mina-tutorial').dataset.step).toBe('openManage'), { timeout: 5000 });
    fireEvent.click(await screen.findByTestId('space-pick-manage', {}, { timeout: 5000 }));
    await waitFor(() => expect(screen.getByTestId('mina-tutorial').dataset.step).toBe('openCreate'), { timeout: 5000 });
    fireEvent.click(await screen.findByTestId('spaces-add', {}, { timeout: 5000 }));
    await waitFor(() => expect(screen.getByTestId('mina-tutorial').dataset.step).toBe('createSpace'), { timeout: 5000 });

    // the name arrives pre-filled but the act is value-flexible — the
    // prefill lands an effect-tick after the input mounts (CI flake)
    const name = (await screen.findByTestId('space-create-name')) as HTMLInputElement;
    await waitFor(() => expect(name.value).toBe(en['mina.suggest.private']), { timeout: 5000 });
    fireEvent.change(name, { target: { value: 'Mijn potje' } });
    fireEvent.click(screen.getByTestId('space-create-save'));
    // act completes on the row existing — and it became the active space
    await waitFor(() => expect(screen.getByTestId('mina-tutorial').dataset.step).toBe('spaceDesign'), { timeout: 5000 });
    const db = new MunniDB(dbName);
    const spaces = await db.spaces.filter((s) => s.deleted === 0).toArray();
    expect(spaces.map((s) => s.name)).toEqual(['Mijn potje']);
    // the ledger SURVIVES the delayed advance (regression: a stale
    // closure once clobbered it back to [], losing $s1/$s2 and sending
    // the cleanup lesson to the wrong space's cog — user ss 2026-07-29)
    const state = (await db.meta.get('minaTutorialState'))?.value as { ledger: { entity: string; id: string }[] };
    expect(state.ledger.filter((e) => e.entity === 'space')).toHaveLength(1);
    db.close();
  }, 30_000);

  it('skip asks Mina-style; confirming reverts the run and re-asserts one space', async () => {
    const dbName = await freshUser();
    await screen.findByTestId('mina-fullscreen', {}, { timeout: 5000 });
    fireEvent.click(screen.getByTestId('mina-skip'));
    const sheet = await screen.findByTestId('mina-skip-sheet');
    expect(sheet.textContent).toContain(en['mina.skipConfirm.yes']);
    // empty ledger → no revert question
    expect(screen.queryByTestId('mina-skip-revert')).toBeNull();
    fireEvent.click(screen.getByTestId('mina-skip-confirm'));

    // the ≥1-space rule re-asserts: a default localized space exists —
    // and the run's ledger is CLEARED, so a later replay can never sweep
    // this run's (now real) resources into its own revert (user rule)
    await waitFor(async () => {
      const db = new MunniDB(dbName);
      const spaces = await db.spaces.filter((s) => s.deleted === 0).toArray();
      const done = (await db.meta.get('minaTutorialDone'))?.value;
      const state = (await db.meta.get('minaTutorialState'))?.value as { active: boolean; ledger: unknown[] };
      db.close();
      expect(spaces.map((s) => s.name)).toEqual([en['mina.suggest.private']]);
      expect(done).toBe(true);
      expect(state.active).toBe(false);
      expect(state.ledger).toHaveLength(0);
    }, { timeout: 5000 });
    await waitFor(() => expect(screen.queryByTestId('mina-tutorial')).toBeNull());
  }, 30_000);
});
