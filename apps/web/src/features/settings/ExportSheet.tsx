import { useState } from 'react';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { shareNativeFile } from '@/lib/platform';
import { visibleAccounts, visibleTransactions } from '@/db/joined';
import { buildCatalog, visibleCategoryRows } from '@/domain/catalog';
import { delimiterForLang, serializeCsv, toCsvRows } from '@/domain/exportCsv';
import { periodHistory } from '@/domain/periods';
import { catName } from '@/features/categories/useCategories';
import { localToday } from '@/application/recurring';
import { Button } from '@/ui/Button';
import { FormBlockerNote, blockerRing } from '@/ui/FormBlockerNote';
import { InfoHint } from '@/ui/InfoHint';
import { Chip } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';

type Scope = 'space' | 'all';
type Range = 'period' | 'year' | 'all' | 'custom';
type Format = 'csv' | 'json';

/** Blob download without leaving the page — nothing is uploaded anywhere.
 * Native shell (§5): the OS share sheet instead, so the export can go
 * straight to Files/mail; the download stays the web/PWA path. */
async function download(name: string, content: string, mime: string): Promise<void> {
  if (await shareNativeFile(name, content)) return;
  const url = URL.createObjectURL(new Blob([content], { type: mime }));
  const a = document.createElement('a');
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** Global settings → Export data (csv-export design): fully client-side. */
export function ExportSheet({ open, onOpenChange }: Readonly<{ open: boolean; onOpenChange: (open: boolean) => void }>) {
  const { t, lang } = useLang();
  const { store, spaceId } = useData();
  const [scope, setScope] = useState<Scope>('space');
  const [range, setRange] = useState<Range>('year');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [format, setFormat] = useState<Format>('csv');
  const [technical, setTechnical] = useState(false);
  const [empty, setEmpty] = useState(false);
  // #195: tappable — an invalid tap names the blocker
  const [attempted, setAttempted] = useState(false);
  const dateBad = range === 'custom' && (!from || !to);
  const close = (next: boolean) => {
    if (!next) setAttempted(false);
    onOpenChange(next);
  };

  const bounds = async (): Promise<{ from: string; to: string } | null> => {
    const today = localToday();
    if (range === 'all') return null;
    if (range === 'year') return { from: `${today.slice(0, 4)}-01-01`, to: today };
    if (range === 'custom') return from && to ? { from, to } : null;
    const space = await store.get('space', spaceId);
    const period = periodHistory(space?.periodType ?? 'month', space?.periodDay ?? 1, 1)[0];
    return { from: period.start, to: period.end };
  };

  const run = async () => {
    setEmpty(false);
    const spaces = scope === 'all'
      ? (await store.allRows('space')).filter((s) => s.deleted === 0)
      : [(await store.get('space', spaceId))!].filter(Boolean);
    const window = await bounds();
    const today = localToday();
    const rangeLabel = window ? `${window.from}--${window.to}` : 'all';

    const allSpaces = (await store.allRows('space')).filter((s) => s.deleted === 0);
    const allCats = (await store.allRows('category')).filter((c) => c.deleted === 0);

    const perSpace = await Promise.all(
      spaces.map(async (space) => {
        const txs = (await visibleTransactions(store, space.id)).filter(
          (item) => !window || (item.date >= window.from && item.date <= window.to),
        );
        const accounts = await visibleAccounts(store, space.id);
        const recurrings = (await store.bySpace('recurring', space.id)).filter((r) => r.deleted === 0);
        const events = (await store.bySpace('event', space.id)).filter((e) => e.deleted === 0);
        return { space, txs, accounts, recurrings, events };
      }),
    );
    if (perSpace.every((entry) => entry.txs.length === 0)) {
      setEmpty(true);
      return;
    }

    if (format === 'json') {
      const payload = perSpace.map(({ space, txs, accounts }) => ({
        space: { id: space.id, name: space.name, currency: space.currency },
        accounts,
        transactions: txs,
      }));
      await download(`munni-${rangeLabel}-${today}.json`, JSON.stringify(payload, null, 2), 'application/json');
      close(false);
      return;
    }

    const rows: string[][] = [];
    for (const { space, txs, accounts, recurrings, events } of perSpace) {
      const visible = visibleCategoryRows(allSpaces, allCats, space.id);
      const catalog = buildCatalog(visible.rows, visible.sharedScope, visible.hiddenMains);
      const spaceRows = toCsvRows(txs, {
        accounts,
        catalog,
        catName: (cat) => catName(cat, t),
        typeName: (type) => t(`tx.type.${type}`),
        recurrings,
        events,
        technical,
        spaceName: scope === 'all' ? space.name : undefined,
      });
      // one shared header row for the whole file
      rows.push(...(rows.length === 0 ? spaceRows : spaceRows.slice(1)));
    }
    await download(`munni-${rangeLabel}-${today}.csv`, serializeCsv(rows, delimiterForLang(lang)), 'text/csv;charset=utf-8');
    close(false);
  };

  const rangeChip = (value: Range, label: string) => (
    <Chip key={value} testId={`export-range-${value}`} selected={range === value} onClick={() => setRange(value)}>
      {label}
    </Chip>
  );

  return (
    <Sheet open={open} onOpenChange={close} title={t('settings.exportData')} size="tall">
      <div className="flex flex-col gap-3 pt-1" data-testid="export-sheet">
        {/* #283: the nothing-is-uploaded note folds behind a hint on the
            first caption row — the paragraph shouted over the form */}
        <div className="m-cap flex flex-wrap items-center gap-1.5 px-1">
          {t('export.scope')}
          <InfoHint text={t('export.note')} testId="export-hint" />
        </div>
        <div className="flex gap-2">
          <Chip testId="export-scope-space" selected={scope === 'space'} onClick={() => setScope('space')}>
            {t('export.scopeSpace')}
          </Chip>
          <Chip testId="export-scope-all" selected={scope === 'all'} onClick={() => setScope('all')}>
            {t('export.scopeAll')}
          </Chip>
        </div>

        <div className="m-cap px-1">{t('export.range')}</div>
        <div className="flex flex-wrap gap-2">
          {rangeChip('period', t('export.rangePeriod'))}
          {rangeChip('year', t('export.rangeYear'))}
          {rangeChip('all', t('export.rangeAll'))}
          {rangeChip('custom', t('export.rangeCustom'))}
        </div>
        {range === 'custom' && (
          <>
            <div className="flex gap-2">
              <input
                data-testid="export-from"
                type="date"
                value={from}
                onChange={(e) => setFrom(e.target.value)}
                aria-invalid={attempted && !from}
                className={`h-11 min-w-0 flex-1 rounded-input border border-line bg-surface px-3 text-[14px] text-ink outline-none${blockerRing(attempted && !from)}`}
              />
              <input
                data-testid="export-to"
                type="date"
                value={to}
                onChange={(e) => setTo(e.target.value)}
                aria-invalid={attempted && !to}
                className={`h-11 min-w-0 flex-1 rounded-input border border-line bg-surface px-3 text-[14px] text-ink outline-none${blockerRing(attempted && !to)}`}
              />
            </div>
            {/* #195 r2 (user): the blocker sits AT the field */}
            <FormBlockerNote show={attempted && dateBad} text={t('form.needDate')} testId="export-run-blocker" />
          </>
        )}

        <div className="m-cap px-1">{t('export.format')}</div>
        <div className="flex gap-2">
          <Chip testId="export-format-csv" selected={format === 'csv'} onClick={() => setFormat('csv')}>
            CSV
          </Chip>
          <Chip testId="export-format-json" selected={format === 'json'} onClick={() => setFormat('json')}>
            {t('export.formatJson')}
          </Chip>
        </div>

        {format === 'csv' && (
          <button
            data-testid="export-technical"
            onClick={() => setTechnical((v) => !v)}
            className="m-tap flex items-center gap-2 border-none bg-transparent px-1 text-left text-[13px] text-ink-2"
          >
            <span
              className={`flex h-5 w-5 items-center justify-center rounded-md border-2 ${
                technical ? 'border-accent bg-accent text-on-brand' : 'border-line bg-surface'
              }`}
            >
              {technical ? '✓' : ''}
            </span>
            {t('export.technical')}
          </button>
        )}

        {empty && (
          <p className="text-[12px] text-warning" data-testid="export-empty">
            {t('export.empty')}
          </p>
        )}
        <Button
          data-testid="export-run"
          onClick={() => {
            if (dateBad) {
              setAttempted(true);
              return;
            }
            void run();
          }}
        >
          {t('export.download')}
        </Button>
      </div>
    </Sheet>
  );
}
