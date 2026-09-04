import { isSpecialCategory } from '@/domain/categories';
import { useLang } from '@/i18n';

/**
 * The "not a random category" diamond (typed-splits v2, user request
 * 2026-08-05): special categories carry system meaning — buckets count
 * them, movements force them — and wear the family-colored mark
 * wherever they are offered or shown. #244: the INCOME family wears it
 * too — with direction gone, the mark is what says "this counts as
 * income" — while staying the one special parent open to user subs.
 */
export function SpecialCatMark({ cat, color }: Readonly<{ cat: { id: string; parentId?: string }; color?: string }>) {
  const { t } = useLang();
  const incomeFamily = cat.id === 'income' || cat.parentId === 'income';
  if (!isSpecialCategory(cat) && !incomeFamily) return null;
  return (
    <span
      data-testid={`speccat-${cat.id}`}
      title={t('cats.special')}
      aria-label={t('cats.special')}
      className="inline-block h-[7px] w-[7px] shrink-0 rotate-45 rounded-[1.5px]"
      style={{ background: color ?? 'var(--m-ink-3)' }}
    />
  );
}
