import { useState } from 'react';
import { useQuery } from '@/db/useQuery';
import { useNavigate } from '@tanstack/react-router';
import { useLang } from '@/i18n';
import { useData } from '@/app/data';
import { useInsightDigest, useInsightOps, useInsights } from '@/application/insights';
import type { Insight, InsightSeverity } from '@/domain/insights';
import { useDisplayMoney } from '@/features/currency/useDisplayMoney';
import { HelpButton } from '@/features/help/HelpButton';
import { AppBar, IconButton } from '@/ui/AppBar';
import { Button } from '@/ui/Button';
import { Collapse } from '@/ui/Collapse';
import { Icon } from '@/ui/Icon';
import { Tile } from '@/ui/primitives';

const SEVERITY_COLOR: Record<InsightSeverity, string> = {
  leak: 'var(--m-negative)',
  pattern: 'var(--m-warning)',
  win: 'var(--m-accent-deep)',
};

/** tiny inline bar chart — the legacy card's sparkline, CSS only */
function MiniBars({ data, color }: Readonly<{ data: number[]; color: string }>) {
  const max = Math.max(...data, 1);
  return (
    <div className="flex h-14 items-end gap-1" data-testid="insight-chart">
      {data.map((value, i) => (
        <span
          key={`${i}-${value}`}
          className="min-w-2 flex-1 rounded-t"
          style={{ height: `${Math.max(6, (value / max) * 100)}%`, background: color, opacity: i === data.length - 1 ? 1 : 0.45 }}
        />
      ))}
    </div>
  );
}

/**
 * Insights (approved design N1): ranked detector findings — what leaks,
 * what patterns cost, what one change would win — with the evidence and
 * a door to the fix. All local math; dismissals sync per space.
 */
export function InsightsScreen() {
  const { t } = useLang();
  const navigate = useNavigate();
  const { store, spaceId } = useData();
  const insights = useInsights();
  const ops = useInsightOps();
  useInsightDigest(insights);
  const space = useQuery(store, async () => store.get('space', spaceId), [spaceId]);
  const currency = space?.currency ?? 'EUR';
  const [open, setOpen] = useState<string | null>(null);

  const { fmt } = useDisplayMoney();
  const money = (cents: number) => fmt(cents, currency);
  const withMoney = (params: Record<string, string | number>) =>
    Object.fromEntries(
      Object.entries(params).map(([key, value]) => [
        key,
        typeof value === 'number' && !['n', 'x', 'months'].includes(key) ? money(value) : value,
      ]),
    );

  const renderCard = (insight: Insight) => {
    const expanded = open === insight.id;
    const color = SEVERITY_COLOR[insight.severity];
    const chart = insight.chart ?? [];
    return (
      <div key={insight.id} className="overflow-hidden rounded-card border border-line bg-surface" data-testid={`insight-${insight.id}`}>
        <button
          data-testid={`insight-head-${insight.id}`}
          onClick={() => setOpen(expanded ? null : insight.id)}
          className="m-tap flex w-full items-start gap-3 border-none bg-transparent px-4 py-3.5 text-left"
        >
          <Tile icon={insight.icon} bg={`color-mix(in srgb, ${color} 13%, transparent)`} color={color} />
          <span className="min-w-0 flex-1">
            <span className="block text-[14px] font-semibold text-ink">{t(insight.titleKey, withMoney(insight.params))}</span>
            <span className="m-num block text-[12px]" style={{ color }}>
              {t(insight.severity === 'win' ? 'ins.impactWin' : 'ins.impactYear', { amount: money(insight.impactCents) })}
            </span>
          </span>
          <Icon name={expanded ? 'chevron-up' : 'chevron-down'} size={16} color="var(--m-ink-4)" />
        </button>
        <Collapse open={expanded}>
          <div className="border-t border-line-2 bg-bg-2/50 px-4 py-3" data-testid={`insight-body-${insight.id}`}>
            {chart.length > 1 && <MiniBars data={chart} color={color} />}
            <p className="mt-2 text-[13px] leading-relaxed text-ink-2">{t(insight.detailKey, withMoney(insight.params))}</p>
            <div className="mt-3 flex items-center gap-2">
              {insight.actionTo && (
                <Button size="sm" data-testid="insight-action" onClick={() => void navigate({ to: insight.actionTo! })}>
                  {t('ins.action')}
                </Button>
              )}
              <button
                data-testid="insight-dismiss"
                onClick={() => void ops.dismiss(insight.id)}
                className="m-tap border-none bg-transparent text-[12px] text-ink-4"
              >
                {t('action.dismiss')}
              </button>
            </div>
          </div>
        </Collapse>
      </div>
    );
  };

  return (
    <div className="m-fade flex h-full flex-col" data-testid="screen-insights">
      <AppBar
        title={t('ins.title')}
        leading={
          <IconButton label={t('action.back')} testId="insights-back" onClick={() => window.history.back()}>
            <Icon name="arrow-left" size={22} />
          </IconButton>
        }
        trailing={<HelpButton tourId="insights" />}
      />
      <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-6">
        <p className="px-1 pb-3 text-[12px] text-ink-3">{t('ins.freshness')}</p>
        {(insights ?? []).length > 0 && <div className="flex flex-col gap-2.5">{(insights ?? []).map(renderCard)}</div>}
        {insights?.length === 0 && (
          <div className="flex flex-col items-center gap-2 px-6 pt-16 text-center" data-testid="insights-empty">
            <Icon name="lightbulb-outline" size={34} color="var(--m-ink-4)" />
            <p className="text-[14px] font-medium text-ink-2">{t('ins.emptyTitle')}</p>
            <p className="text-[12px] text-ink-4">{t('ins.emptyBody')}</p>
          </div>
        )}
      </div>
    </div>
  );
}
