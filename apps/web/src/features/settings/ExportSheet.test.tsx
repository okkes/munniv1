// @vitest-environment happy-dom
import 'fake-indexeddb/auto';
import { fireEvent, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { renderApp } from '@/test/harness';

/** capture the exported blob; keep URL a constructor and clicks inert */
function captureDownloads(): Blob[] {
  const blobs: Blob[] = [];
  (URL as { createObjectURL?: unknown }).createObjectURL = vi.fn((blob: Blob) => {
    blobs.push(blob);
    return 'blob:test';
  });
  (URL as { revokeObjectURL?: unknown }).revokeObjectURL = vi.fn();
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined);
  return blobs;
}

describe('ExportSheet (demo identity)', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
    indexedDB.deleteDatabase('munni_demo');
  });
  afterEach(() => vi.restoreAllMocks());

  it('downloads a CSV of the current space with localized categories', async () => {
    const blobs = captureDownloads();

    renderApp('/settings/global');
    fireEvent.click(await screen.findByTestId('settings-export-row'));
    await screen.findByTestId('export-sheet');
    // everything, so relative demo dates can't empty the window
    fireEvent.click(screen.getByTestId('export-range-all'));
    fireEvent.click(screen.getByTestId('export-run'));

    await waitFor(() => expect(blobs).toHaveLength(1), { timeout: 5000 });
    const text = await blobs[0].text();
    const lines = text.split('\r\n');
    expect(lines[0]).toContain('date,time,account,merchant'); // EN delimiter = comma
    expect(text).toContain('Albert Heijn');
    expect(text).toContain('Grocery'); // localized category name
    expect(lines.length).toBeGreaterThan(50); // the demo history came along
  }, 15_000);

  it('exports a JSON backup across all spaces', async () => {
    const blobs = captureDownloads();

    renderApp('/settings/global');
    fireEvent.click(await screen.findByTestId('settings-export-row'));
    await screen.findByTestId('export-sheet');
    fireEvent.click(screen.getByTestId('export-scope-all'));
    fireEvent.click(screen.getByTestId('export-range-all'));
    fireEvent.click(screen.getByTestId('export-format-json'));
    fireEvent.click(screen.getByTestId('export-run'));

    await waitFor(() => expect(blobs).toHaveLength(1), { timeout: 5000 });
    const payload = JSON.parse(await blobs[0].text()) as { space: { name: string }; transactions: unknown[] }[];
    expect(payload.length).toBeGreaterThan(0);
    expect(payload[0].transactions.length).toBeGreaterThan(0);
  }, 15_000);
});
