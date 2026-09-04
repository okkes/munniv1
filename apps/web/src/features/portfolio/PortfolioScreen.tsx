import { useEffect, useRef, useState } from 'react';
import { useNavigate } from '@tanstack/react-router';
import { useLang } from '@/i18n';
import type { TranslationKey } from '@/i18n';
import { quotesAvailable, usePortfolio, usePortfolioOps, useQuoteRefresh } from '@/application/portfolio';
import type { DegiroImportResult } from '@/application/portfolio';
import type { AssetClass, HoldingRow } from '@/db/types';
import { apiFetch } from '@/lib/api';
import { fmtCents, fmtSignedPct, parseCents } from '@/lib/money';
import { HelpButton } from '@/features/help/HelpButton';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { FormBlockerNote, blockerRing } from '@/ui/FormBlockerNote';
import { Icon } from '@/ui/Icon';
import { Chip } from '@/ui/primitives';
import { Sheet } from '@/ui/Sheet';
import { SearchField } from '@/ui/SearchField';

export const ASSET_CLASSES: { id: AssetClass; labelKey: TranslationKey; icon: string }[] = [
  { id: 'stock', labelKey: 'pf.classStock', icon: 'chart-line' },
  { id: 'etf', labelKey: 'pf.classEtf', icon: 'chart-box-outline' },
  { id: 'crypto', labelKey: 'pf.classCrypto', icon: 'currency-btc' },
  { id: 'cash', labelKey: 'pf.classCash', icon: 'cash' },
  { id: 'other', labelKey: 'pf.classOther', icon: 'diamond-stone' },
];

export const CLASS_COLORS: Record<AssetClass, string> = {
  stock: 'var(--m-accent)',
  etf: 'var(--m-info)',
  crypto: 'var(--m-warning)',
  cash: 'var(--m-ink-4)',
  other: 'var(--m-special)',
};

interface SearchHits {
  stocks: { symbol: string; name: string; exchange?: string }[];
  coins: { id: string; name: string; symbol: string }[];
}

/** create/edit a holding: live search when signed in, manual always */
export function HoldingFormSheet({ initial, onClose }: Readonly<{ initial: HoldingRow | 'new' | null; onClose: () => void }>) {
  const { t } = useLang();
  const ops = usePortfolioOps();
  const editing = initial !== 'new' && initial !== null ? initial : null;
  const [name, setName] = useState('');
  const [assetClass, setAssetClass] = useState<AssetClass>('stock');
  const [priceKey, setPriceKey] = useState<{ source: 'yahoo' | 'coingecko'; key: string } | null>(null);
  const [manualPrice, setManualPrice] = useState('');
  const [query, setQuery] = useState('');
  const [hits, setHits] = useState<SearchHits | null>(null);
  const [confirmDelete, setConfirmDelete] = useState(false);
  // #195: tappable — an invalid tap names the blocker
  const [attempted, setAttempted] = useState(false);
  const searchTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    setName(editing?.name ?? '');
    setAssetClass(editing?.assetClass ?? 'stock');
    let liveKey: { source: 'yahoo' | 'coingecko'; key: string } | null = null;
    if (editing?.priceKey && (editing.priceSource === 'yahoo' || editing.priceSource === 'coingecko')) {
      liveKey = { source: editing.priceSource, key: editing.priceKey };
    }
    setPriceKey(liveKey);
    setManualPrice(editing?.manualPriceCents === undefined ? '' : (editing.manualPriceCents / 100).toFixed(2));
    setQuery('');
    setHits(null);
    setConfirmDelete(false);
    setAttempted(false);
  }, [initial, editing]);

  // debounced symbol search through the quotes proxy (signed-in only)
  useEffect(() => {
    if (!quotesAvailable() || query.trim().length < 2) {
      setHits(null);
      return;
    }
    clearTimeout(searchTimer.current);
    searchTimer.current = setTimeout(() => {
      void (async () => {
        const response = await apiFetch(`/quotes/search?q=${encodeURIComponent(query.trim())}`);
        if (response.ok) setHits((await response.json()) as SearchHits);
      })().catch(() => undefined);
    }, 350);
    return () => clearTimeout(searchTimer.current);
  }, [query]);

  const save = async () => {
    if (!name.trim()) return;
    const manualCents = parseCents(manualPrice);
    await ops.saveHolding(editing?.id ?? null, {
      name: name.trim(),
      assetClass,
      currency: 'EUR',
      symbol: priceKey?.source === 'yahoo' ? priceKey.key : editing?.symbol,
      priceSource: priceKey?.source ?? 'manual',
      priceKey: priceKey?.key,
      manualPriceCents: manualCents !== null && manualCents >= 0 && manualPrice !== '' ? manualCents : undefined,
      archived: editing?.archived ?? 0,
    });
    onClose();
  };

  const removeHolding = async () => {
    if (!editing) return;
    if (!confirmDelete) {
      setConfirmDelete(true);
      return;
    }
    await ops.removeHolding(editing.id);
    onClose();
  };

  return (
    <Sheet open={initial !== null} onOpenChange={(open) => !open && onClose()} title={editing ? t('pf.edit') : t('pf.new')} size="tall">
      <div className="flex flex-col gap-3 pt-1">
        {quotesAvailable() && (
          <>
            <SearchField
              testId="pf-search"
              value={query}
              onChange={setQuery}
              placeholder={t('pf.searchPlaceholder')}
              textSize="text-[14px]"
            />
            {hits && (hits.stocks.length > 0 || hits.coins.length > 0) && (
              <div className="max-h-44 overflow-y-auto rounded-card border border-line bg-surface" data-testid="pf-search-hits">
                {hits.stocks.map((hit) => (
                  <button
                    key={hit.symbol}
                    data-testid={`pf-hit-${hit.symbol}`}
                    onClick={() => {
                      setName(hit.name);
                      setPriceKey({ source: 'yahoo', key: hit.symbol });
                      setQuery('');
                      setHits(null);
                    }}
                    className="m-tap flex w-full items-center gap-2 border-b border-line-2 px-3 py-2.5 text-left text-[13px] text-ink last:border-0"
                  >
                    <span className="min-w-0 flex-1 truncate">{hit.name}</span>
                    <span className="font-mono text-[11px] text-ink-4">{hit.symbol}</span>
                  </button>
                ))}
                {hits.coins.map((hit) => (
                  <button
                    key={hit.id}
                    data-testid={`pf-hit-${hit.id}`}
                    onClick={() => {
                      setName(hit.name);
                      setAssetClass('crypto');
                      setPriceKey({ source: 'coingecko', key: hit.id });
                      setQuery('');
                      setHits(null);
                    }}
                    className="m-tap flex w-full items-center gap-2 border-b border-line-2 px-3 py-2.5 text-left text-[13px] text-ink last:border-0"
                  >
                    <Icon name="currency-btc" size={14} color="#F39C12" />
                    <span className="min-w-0 flex-1 truncate">{hit.name}</span>
                    <span className="font-mono text-[11px] uppercase text-ink-4">{hit.symbol}</span>
                  </button>
                ))}
              </div>
            )}
          </>
        )}
        <input
          data-testid="pf-name"
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder={t('pf.namePlaceholder')}
          aria-invalid={attempted && !name.trim()}
          className={`h-12 w-full rounded-input border border-line bg-surface px-4 text-[15px] text-ink outline-none placeholder:text-ink-4${blockerRing(attempted && !name.trim())}`}
        />
        {/* #195 r2 (user): the blocker sits AT the field */}
        <FormBlockerNote show={attempted && !name.trim()} text={t('form.needName')} testId="pf-save-blocker" />
        <div className="flex gap-1.5 overflow-x-auto pb-1">
          {ASSET_CLASSES.map((candidate) => (
            <Chip
              key={candidate.id}
              testId={`pf-class-${candidate.id}`}
              selected={assetClass === candidate.id}
              onClick={() => setAssetClass(candidate.id)}
            >
              <Icon name={candidate.icon} size={14} />
              {t(candidate.labelKey)}
            </Chip>
          ))}
        </div>
        {priceKey ? (
          <div className="flex items-center gap-2 rounded-card border border-line bg-surface px-3 py-2.5 text-[12px] text-ink-2" data-testid="pf-live-price">
            <Icon name="lightning-bolt-outline" size={15} color="var(--m-accent-deep)" />
            <span className="min-w-0 flex-1 truncate">{t('pf.livePrice', { key: priceKey.key })}</span>
            <button data-testid="pf-live-clear" onClick={() => setPriceKey(null)} className="m-tap border-none bg-transparent text-ink-4">
              ✕
            </button>
          </div>
        ) : (
          <label className="text-[12px] text-ink-3">
            {t('pf.manualPrice')}
            <input
              data-testid="pf-manual-price"
              type="number"
              inputMode="decimal"
              step="0.01"
              min="0"
              value={manualPrice}
              onChange={(e) => setManualPrice(e.target.value)}
              placeholder="0.00"
              className="mt-1 h-11 w-full rounded-input border border-line bg-surface px-3 font-mono text-[14px] text-ink outline-none placeholder:text-ink-4"
            />
          </label>
        )}
        <Button
          data-testid="pf-save"
          onClick={() => {
            if (!name.trim()) {
              setAttempted(true);
              return;
            }
            void save();
          }}
        >
          {editing ? t('action.save') : t('action.create')}
        </Button>
        {editing && (
          <Button variant="danger" data-testid="pf-delete" onClick={() => void removeHolding()}>
            {confirmDelete ? t('action.confirm') : t('action.delete')}
          </Button>
        )}
      </div>
    </Sheet>
  );
}

/** The portfolio: what you own, what it's worth, whether you're winning. */
export function PortfolioScreen() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const model = usePortfolio();
  const ops = usePortfolioOps();
  useQuoteRefresh();
  const [formInitial, setFormInitial] = useState<HoldingRow | 'new' | null>(null);
  const [importResult, setImportResult] = useState<DegiroImportResult | null>(null);
  const importRef = useRef<HTMLInputElement>(null);

  const money = (cents: number) => fmtCents(cents, 'EUR', lang);

  const onImport = async (files: FileList | null) => {
    if (!files?.length) return;
    const contents = await Promise.all([...files].map(async (f) => ({ name: f.name, text: await f.text() })));
    setImportResult(await ops.importDegiro(contents));
  };

  const active = (model?.views ?? []).filter((v) => v.holding.archived !== 1);

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-portfolio">
      {/* a bottom tab like Home — same large left-aligned header, no back */}
      <AppBar
        large
        title={t('pf.title')}
        trailing={
          <>
            <HelpButton tourId="portfolio" />
            <IconButton label={t('pf.new')} testId="pf-add" onClick={() => setFormInitial('new')}>
              <Icon name="plus" size={22} />
            </IconButton>
          </>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        {model && active.length > 0 && (
          <div className="rounded-card border border-line bg-surface p-4" data-testid="pf-hero">
            <div className="m-num text-[28px] font-semibold text-ink" data-testid="pf-total">
              {money(model.totals.totalCents)}
            </div>
            <div className="mt-0.5 flex flex-wrap gap-x-3 text-[12px]">
              {model.totals.dayChangeCents !== null && (
                <span className="m-num font-medium" style={{ color: model.totals.dayChangeCents >= 0 ? 'var(--m-accent-deep)' : 'var(--m-negative)' }} data-testid="pf-day">
                  {fmtCents(model.totals.dayChangeCents, 'EUR', lang, { sign: true })} {t('pf.today')}
                </span>
              )}
              <span className="m-num text-ink-3">
                {fmtCents(model.totals.gainCents, 'EUR', lang, { sign: true })} {t('pf.total')}
              </span>
            </div>
            {/* allocation as a stacked bar — the mix at a glance */}
            {model.totals.totalCents > 0 && (
              <div className="mt-3 flex h-2 overflow-hidden rounded-full bg-bg-2" data-testid="pf-allocation">
                {model.totals.allocation.map((slice) => (
                  <span key={slice.assetClass} style={{ width: `${slice.share * 100}%`, background: CLASS_COLORS[slice.assetClass] }} />
                ))}
              </div>
            )}
            {model.totals.concentrated && (
              <p className="mt-2 text-[11px] text-warning" data-testid="pf-concentrated">
                {t('pf.concentrated', { name: model.totals.concentrated })}
              </p>
            )}
            {model.totals.unpricedCount > 0 && (
              <p className="mt-1 text-[11px] text-ink-4" data-testid="pf-unpriced">
                {t('pf.unpriced', { n: model.totals.unpricedCount })}
              </p>
            )}
          </div>
        )}

        <div className="mt-3 flex flex-col gap-2" data-testid="pf-list">
          {active.map((view) => (
            <button
              key={view.holding.id}
              data-testid={`pf-holding-${view.holding.id}`}
              onClick={() => void navigate({ to: '/portfolio/$holdingId', params: { holdingId: view.holding.id } })}
              className="m-tap flex w-full items-center gap-3 rounded-card border border-line bg-surface px-4 py-3 text-left"
            >
              <Icon
                name={ASSET_CLASSES.find((c) => c.id === view.holding.assetClass)?.icon ?? 'chart-line'}
                size={18}
                color={CLASS_COLORS[view.holding.assetClass]}
              />
              <span className="min-w-0 flex-1">
                <span className="block truncate text-[14px] font-medium text-ink">{view.holding.name}</span>
                <span className="block text-[11px] text-ink-4">
                  {view.position.qty} {view.holding.symbol ? `· ${view.holding.symbol}` : ''}
                </span>
              </span>
              <span className="text-right">
                <span className="m-num block text-[14px] font-semibold text-ink">
                  {view.valueCents === null ? '—' : money(view.valueCents)}
                </span>
                {view.gainPct !== null && (
                  <span className="m-num block text-[11px]" style={{ color: view.gainCents! >= 0 ? 'var(--m-accent-deep)' : 'var(--m-negative)' }}>
                    {fmtSignedPct(view.gainPct)}
                  </span>
                )}
              </span>
            </button>
          ))}
        </div>

        {model && active.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 pt-16 text-center" data-testid="pf-empty">
            <Icon name="chart-line" size={34} color="var(--m-ink-4)" />
            <p className="text-[14px] font-medium text-ink-2">{t('pf.emptyTitle')}</p>
            <p className="text-[12px] text-ink-4">{t('pf.emptyBody')}</p>
          </div>
        )}

        {/* the official, stable route in: DEGIRO's own exports */}
        <input ref={importRef} data-testid="pf-import-file" type="file" accept=".csv,text/csv" multiple className="hidden" onChange={(e) => void onImport(e.target.files)} />
        <button
          data-testid="pf-import"
          onClick={() => importRef.current?.click()}
          className="m-tap mt-4 flex w-full items-center gap-3 rounded-card border border-dashed border-line bg-surface px-4 py-3 text-left"
        >
          <Icon name="file-upload-outline" size={19} color="var(--m-ink-3)" />
          <span className="min-w-0 flex-1">
            <span className="block text-[13px] font-medium text-ink">{t('pf.import')}</span>
            <span className="block text-[11px] text-ink-4">{t('pf.importSub')}</span>
          </span>
        </button>
        {importResult && (
          <p className="mt-1 px-1 text-[12px] text-accent-deep" data-testid="pf-import-result">
            {t('pf.importResult', { holdings: importResult.holdings, lots: importResult.lots })}
          </p>
        )}
      </div>
      <HoldingFormSheet initial={formInitial} onClose={() => setFormInitial(null)} />
    </div>
  );
}
