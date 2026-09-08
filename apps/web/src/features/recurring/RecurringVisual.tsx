import type { RecurringKind, RecurringRow } from '@/db/types';
import type { TFunc } from '@/i18n';
import { Icon } from '@/ui/Icon';

export const KIND_ICON: Record<RecurringKind, string> = {
  fixed: 'home-lightning-bolt-outline',
  subscription: 'television-play',
};

/** human cadence: "Monthly", "Yearly", "Weekly", "Every 3 months", … */
export function cadenceLabel(rec: Pick<RecurringRow, 'every' | 'everyN'>, t: TFunc): string {
  const n = Math.max(1, rec.everyN ?? 1);
  if (rec.every === 'week') return n === 1 ? t('recurring.everyWeek') : t('recurring.everyNWeeks', { n });
  if (rec.every === 'year') return n === 1 ? t('recurring.everyYear') : t('recurring.everyNYears', { n });
  return n === 1 ? t('recurring.everyMonth') : t('recurring.everyNMonths', { n });
}

/** brand logo when set, the kind's MDI icon otherwise. With `fill`, the
 *  logo COVERS the parent tile edge to edge (user request: no colored
 *  padding around the artwork — a slight crop is fine); the parent must
 *  be a relative rounded tile. Bare rows keep the contained thumbnail. */
export function RecurringVisual({
  rec,
  size = 17,
  active = true,
  fill = false,
}: Readonly<{ rec: Pick<RecurringRow, 'logo' | 'icon' | 'kind'>; size?: number; active?: boolean; fill?: boolean }>) {
  if (rec.logo) {
    if (fill) return <img src={rec.logo} alt="" className="absolute inset-0 h-full w-full rounded-[inherit] object-cover" />;
    const logoSize = Math.round(size * 1.75);
    return <img src={rec.logo} alt="" className="rounded-md object-contain" style={{ width: logoSize, height: logoSize }} />;
  }
  return <Icon name={rec.icon ?? KIND_ICON[rec.kind]} size={size} color={active ? 'var(--m-accent-deep)' : 'var(--m-ink-2)'} />;
}
