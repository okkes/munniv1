// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { cleanup, fireEvent, screen, waitFor } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { USER_TEST_DB, renderApp, renderAppAsUser } from '@/test/harness';

const DEGIRO_TX = [
  'Datum,Tijd,Product,ISIN,Beurs,Uitvoeringsplaats,Aantal,Koers,,Lokale waarde,,Waarde,,Wisselkoers,Transactiekosten en/of,,Totaal,Order ID',
  '02-06-2026,09:15,ASML HOLDING,NL0010273215,EAM,,2,640,,-1280,,-1280.00,,,-2.00,,-1282.00,ord-1',
].join('\n');

async function createManualHolding(name: string, price: string) {
  fireEvent.click(await screen.findByTestId('pf-add'));
  await screen.findByTestId('pf-name');
  fireEvent.change(screen.getByTestId('pf-name'), { target: { value: name } });
  fireEvent.change(screen.getByTestId('pf-manual-price'), { target: { value: price } });
  fireEvent.click(screen.getByTestId('pf-save'));
  const row = await waitFor(
    () => {
      const el = document.querySelector('[data-testid^="pf-holding-"]');
      expect(el).toBeTruthy();
      return el!;
    },
    { timeout: 5000 },
  );
  return row;
}

describe('Portfolio (demo identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
    indexedDB.deleteDatabase(USER_TEST_DB);
  });

  it('a manual holding with lots values the position and totals', async () => {
    renderApp('/portfolio');
    await screen.findByTestId('screen-portfolio');
    await screen.findByTestId('pf-empty');
    // demo identity: the live symbol search never renders (no network)
    fireEvent.click(screen.getByTestId('pf-add'));
    await screen.findByTestId('pf-name');
    expect(screen.queryByTestId('pf-search')).toBeNull();
    fireEvent.click(screen.getByTestId('pf-save')); // empty name: refused with the blocker (#195)
    expect(await screen.findByTestId('pf-save-blocker')).toBeTruthy();
    fireEvent.change(screen.getByTestId('pf-name'), { target: { value: 'Garage fund' } });
    await waitFor(() => expect(screen.queryByTestId('pf-save-blocker')).toBeNull());
    fireEvent.change(screen.getByTestId('pf-manual-price'), { target: { value: '50' } });
    fireEvent.click(screen.getByTestId('pf-save'));

    const row = await waitFor(() => {
      const el = document.querySelector('[data-testid^="pf-holding-"]');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.click(row);
    await screen.findByTestId('pfdetail-hero');

    // buy 3 @ €40 → value 3 × €50 manual = €150, gain +€30
    fireEvent.click(screen.getByTestId('pfdetail-addlot'));
    await screen.findByTestId('pf-lot-qty');
    fireEvent.change(screen.getByTestId('pf-lot-qty'), { target: { value: '3' } });
    fireEvent.change(screen.getByTestId('pf-lot-price'), { target: { value: '40' } });
    fireEvent.click(screen.getByTestId('pf-lot-save'));
    await waitFor(() => expect(screen.getByTestId('pfdetail-value').textContent).toMatch(/€150[.,]00/), { timeout: 5000 });
    expect(screen.getByTestId('pfdetail-qty').textContent).toContain('3');

    cleanup();
    renderApp('/portfolio');
    const total = await screen.findByTestId('pf-total', {}, { timeout: 5000 });
    expect(total.textContent).toMatch(/€150[.,]00/);
  }, 15_000);

  it('the DEGIRO transactions export imports idempotently', async () => {
    renderApp('/portfolio');
    await screen.findByTestId('screen-portfolio');
    await screen.findByTestId('pf-empty');

    const file = new File([DEGIRO_TX], 'Transactions.csv', { type: 'text/csv' });
    fireEvent.change(screen.getByTestId('pf-import-file'), { target: { files: [file] } });
    const result = await screen.findByTestId('pf-import-result', {}, { timeout: 5000 });
    expect(result.textContent).toContain('1');
    await waitFor(() => expect(document.querySelector('[data-testid^="pf-holding-"]')?.textContent).toContain('ASML'));

    // second import: nothing new (deterministic ids)
    fireEvent.change(screen.getByTestId('pf-import-file'), { target: { files: [file] } });
    await waitFor(() => expect(screen.getByTestId('pf-import-result').textContent).toMatch(/0 .* 0|0 pos|0 holdings/i));
  }, 15_000);

  it('a signed-in user searches a symbol and delayed quotes price the position', async () => {
    const api = {
      'GET /quotes/search': () => ({ stocks: [{ symbol: 'ASML.AS', name: 'ASML Holding', exchange: 'Amsterdam' }], coins: [] }),
      'GET /quotes': () => ({
        quotes: [{ key: 'yahoo:ASML.AS', price: 650, currency: 'EUR', dayChangePct: 2 }],
      }),
    };
    renderAppAsUser('/portfolio', { api });
    await screen.findByTestId('screen-portfolio');

    // pick the live symbol from the debounced search
    fireEvent.click(await screen.findByTestId('pf-add'));
    fireEvent.change(await screen.findByTestId('pf-search'), { target: { value: 'asml' } });
    fireEvent.click(await screen.findByTestId('pf-hit-ASML.AS', {}, { timeout: 5000 }));
    await waitFor(() => expect(screen.getByTestId('pf-live-price').textContent).toContain('ASML.AS'));
    fireEvent.click(screen.getByTestId('pf-save'));

    const row = await waitFor(() => {
      const el = document.querySelector('[data-testid^="pf-holding-"]');
      expect(el).toBeTruthy();
      return el!;
    });
    fireEvent.click(row);
    await screen.findByTestId('pfdetail-hero');
    fireEvent.click(screen.getByTestId('pfdetail-addlot'));
    await screen.findByTestId('pf-lot-qty');
    fireEvent.change(screen.getByTestId('pf-lot-qty'), { target: { value: '2' } });
    fireEvent.change(screen.getByTestId('pf-lot-price'), { target: { value: '600' } });
    fireEvent.click(screen.getByTestId('pf-lot-save'));
    await waitFor(() => expect(screen.getByTestId('pfdetail-qty').textContent).toContain('2'));

    // a fresh mount refreshes quotes → 2 × €650 with the +2% day move
    cleanup();
    renderAppAsUser('/portfolio', { api });
    const total = await screen.findByTestId('pf-total', {}, { timeout: 5000 });
    await waitFor(() => expect(total.textContent).toMatch(/€1[.,]300[.,]00/), { timeout: 5000 });
    expect(screen.getByTestId('pf-day').textContent).toMatch(/\+/);
  }, 20_000);

  it('the tab bar reaches the portfolio (own tab, user ruling)', async () => {
    renderApp('/home');
    await screen.findByTestId('screen-home');
    fireEvent.click(screen.getAllByTestId('tab-portfolio')[0]);
    await screen.findByTestId('screen-portfolio');
    const row = await createManualHolding('Garage fund', '50');
    expect(row.textContent).toContain('Garage fund');
  }, 15_000);
});
