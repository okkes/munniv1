import { useEffect, useState } from 'react';
import { useNavigate, useParams } from '@tanstack/react-router';
import { LOCALES, useLang } from '@/i18n';
import { usePortfolio, usePortfolioOps } from '@/application/portfolio';
import { useData } from '@/app/data';
import { useQuery } from '@/db/useQuery';
import type { HoldingRow, LotRow } from '@/db/types';
import { fmtCents, parseCents } from '@/lib/money';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Icon } from '@/ui/Icon';
import { Sheet } from '@/ui/Sheet';
import { HoldingFormSheet } from './PortfolioScreen';

const LOT_KINDS = ['buy', 'sell', 'dividend', 'fee'] as const;
const LOT_ICON: Record<string, string> = { buy: 'tray-arrow-down', sell: 'tray-arrow-up', dividend: 'cash-plus', fee: 'cash-minus' };

/** One holding: the position, its worth, and the audit trail behind it. */
export function HoldingDetailScreen() {
  const { t, lang } = useLang();
  const navigate = useNavigate();
  const { store, spaceId } = useData();
  const { holdingId } = useParams({ strict: false }) as { holdingId: string };
  const model = usePortfolio();
  const ops = usePortfolioOps();
  const lots = useQuery(store, 
    async () => {
      const rows = (await store.bySpace('lot', spaceId)).filter((l) => l.deleted === 0 && l.holdingId === holdingId);
      rows.sort((a, b) => b.date.localeCompare(a.date));
      return rows;
    },
    [spaceId, holdingId],
  );
  const [formInitial, setFormInitial] = useState<HoldingRow | 'new' | null>(null);
  const [lotOpen, setLotOpen] = useState(false);
  const [kind, setKind] = useState<(typeof LOT_KINDS)[number]>('buy');
  const [date, setDate] = useState(new Date().toISOString().slice(0, 10));
  const [qty, setQty] = useState('');
  const [unitPrice, setUnitPrice] = useState('');

  const view = model?.views.find((v) => v.holding.id === holdingId);
  // deleted here or on another device: leave the orphaned detail
  useEffect(() => {
    if (model && !view) void navigate({ to: '/portfolio', replace: true });
  }, [model, view, navigate]);
  if (!view)
    return <div className="h-full" data-testid="screen-holding-detail" />;

  const money = (cents: number) => fmtCents(cents, 'EUR', lang);
  const fmtDate = (iso: string) => new Date(iso).toLocaleDateString(LOCALES[lang], { day: 'numeric', month: 'short', year: 'numeric' });

  const saveLot = async () => {
    const quantity = Number.parseFloat(qty.replace(',', '.'));
    const priceCents = parseCents(unitPrice);
    if (priceCents === null || priceCents <= 0) return;
    const isTrade = kind === 'buy' || kind === 'sell';
    if (isTrade && (!Number.isFinite(quantity) || quantity <= 0)) return;
    // buys take cash out, everything else brings value in
    let totalCents = priceCents;
    if (isTrade) totalCents = Math.round(quantity * priceCents) * (kind === 'buy' ? -1 : 1);
    await ops.addLot(view.holding.id, {
      kind,
      date,
      quantity: isTrade ? quantity : undefined,
      priceCents: isTrade ? priceCents : undefined,
      totalCents,
    });
    setLotOpen(false);
    setQty('');
    setUnitPrice('');
  };

  const renderLot = (lot: LotRow) => (
    <div key={lot.id} className="flex items-center gap-3 border-b border-line-2 py-2.5 last:border-0" data-testid={`pf-lot-${lot.id}`}>
      <Icon name={LOT_ICON[lot.kind]} size={16} color={lot.kind === 'buy' || lot.kind === 'dividend' ? 'var(--m-accent-deep)' : 'var(--m-ink-3)'} />
      <span className="min-w-0 flex-1">
        <span className="block text-[13px] text-ink">
          {t(`pf.lot.${lot.kind}`)}
          {lot.quantity === undefined ? '' : ` · ${lot.quantity}`}
        </span>
        <span className="block text-[11px] text-ink-4">{fmtDate(lot.date)}</span>
      </span>
      <span className="m-num text-[13px] font-semibold text-ink">{money(Math.abs(lot.totalCents))}</span>
      <button
        aria-label={t('action.delete')}
        data-testid={`pf-lot-del-${lot.id}`}
        onClick={() => void ops.removeLot(lot.id)}
        className="m-tap flex h-8 w-8 items-center justify-center rounded-full border-none bg-transparent"
      >
        <Icon name="close" size={14} color="var(--m-ink-4)" />
      </button>
    </div>
  );

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-holding-detail">
      <AppBar
        title={view.holding.name}
        leading={
          <IconButton label={t('action.back')} testId="pfdetail-back" onClick={() => window.history.back()}>
            <Icon name="arrow-left" size={22} />
          </IconButton>
        }
        trailing={
          <IconButton label={t('pf.edit')} testId="pfdetail-edit" onClick={() => setFormInitial(view.holding)}>
            <Icon name="pencil-outline" size={20} />
          </IconButton>
        }
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <div className="rounded-card border border-line bg-surface p-4" data-testid="pfdetail-hero">
          <div className="m-num text-[24px] font-semibold text-ink" data-testid="pfdetail-value">
            {view.valueCents === null ? t('pf.noPrice') : money(view.valueCents)}
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-[12px] text-ink-3">
            <span data-testid="pfdetail-qty">
              {view.position.qty} {t('pf.units')}
            </span>
            {view.position.qty > 0 && <span>{t('pf.avgCost', { amount: money(Math.round(view.position.costCents / view.position.qty)) })}</span>}
            {view.gainCents !== null && (
              <span className="m-num font-medium" style={{ color: view.gainCents >= 0 ? 'var(--m-accent-deep)' : 'var(--m-negative)' }}>
                {fmtCents(view.gainCents, 'EUR', lang, { sign: true })}
              </span>
            )}
          </div>
          {(view.position.realizedCents !== 0 || view.position.dividendCents > 0 || view.position.feeCents > 0) && (
            <div className="mt-2 flex flex-wrap gap-x-4 text-[11px] text-ink-4" data-testid="pfdetail-extras">
              {view.position.realizedCents !== 0 && <span>{t('pf.realized', { amount: money(view.position.realizedCents) })}</span>}
              {view.position.dividendCents > 0 && <span>{t('pf.dividends', { amount: money(view.position.dividendCents) })}</span>}
              {view.position.feeCents > 0 && <span>{t('pf.fees', { amount: money(view.position.feeCents) })}</span>}
            </div>
          )}
        </div>

        <Button className="mt-3 w-full" data-testid="pfdetail-addlot" onClick={() => setLotOpen(true)}>
          {t('pf.addLot')}
        </Button>

        <div className="m-cap mt-5 mb-1 px-1">
          {t('pf.lots')} · {lots?.length ?? 0}
        </div>
        {(lots?.length ?? 0) > 0 ? (
          <div className="rounded-card border border-line bg-surface px-4 py-1" data-testid="pfdetail-lots">
            {lots!.map(renderLot)}
          </div>
        ) : (
          <p className="px-1 text-[12px] text-ink-4">{t('pf.noLots')}</p>
        )}
      </div>

      {/* add a lot: trades want qty × price, income/fees just a total */}
      <Sheet open={lotOpen} onOpenChange={(open) => !open && setLotOpen(false)} title={t('pf.addLot')} size="tall">
        <div className="flex flex-col gap-3 pt-1">
          <div className="flex gap-1.5">
            {LOT_KINDS.map((candidate) => (
              <button
                key={candidate}
                data-testid={`pf-lotkind-${candidate}`}
                onClick={() => setKind(candidate)}
                className={`m-tap flex-1 rounded-full border px-2 py-1.5 text-[12px] ${
                  kind === candidate ? 'border-accent bg-accent-soft text-accent-deep' : 'border-line bg-surface text-ink-2'
                }`}
              >
                {t(`pf.lot.${candidate}`)}
              </button>
            ))}
          </div>
          <input
            data-testid="pf-lot-date"
            type="date"
            value={date}
            onChange={(e) => setDate(e.target.value)}
            className="h-11 w-full appearance-none rounded-input border border-line bg-surface px-3 text-[14px] text-ink outline-none"
          />
          {(kind === 'buy' || kind === 'sell') && (
            <input
              data-testid="pf-lot-qty"
              type="number"
              inputMode="decimal"
              step="any"
              min="0"
              value={qty}
              onChange={(e) => setQty(e.target.value)}
              placeholder={t('pf.qtyPlaceholder')}
              className="h-11 w-full rounded-input border border-line bg-surface px-3 font-mono text-[14px] text-ink outline-none placeholder:text-ink-4"
            />
          )}
          <input
            data-testid="pf-lot-price"
            type="number"
            inputMode="decimal"
            step="0.01"
            min="0"
            value={unitPrice}
            onChange={(e) => setUnitPrice(e.target.value)}
            placeholder={kind === 'buy' || kind === 'sell' ? t('pf.pricePlaceholder') : t('pf.totalPlaceholder')}
            className="h-11 w-full rounded-input border border-line bg-surface px-3 font-mono text-[14px] text-ink outline-none placeholder:text-ink-4"
          />
          <Button data-testid="pf-lot-save" onClick={() => void saveLot()}>
            {t('action.save')}
          </Button>
        </div>
      </Sheet>

      <HoldingFormSheet initial={formInitial} onClose={() => setFormInitial(null)} />
    </div>
  );
}
