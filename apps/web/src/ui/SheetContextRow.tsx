import { Icon } from '@/ui/Icon';

/** compact context row used inside sheets (review + tx form): a value
 *  with its caption and a pencil, opening a stacked picker */
export function SheetContextRow({
  testId,
  icon,
  iconColor,
  value,
  caption,
  onClick,
}: Readonly<{
  testId: string;
  icon: string;
  iconColor: string;
  value: string;
  caption: string;
  onClick: () => void;
}>) {
  return (
    <button
      data-testid={testId}
      onClick={onClick}
      className="m-tap flex w-full items-center gap-2.5 rounded-input border border-line bg-surface px-3 py-2.5 text-left text-[14px] text-ink"
    >
      <Icon name={icon} size={17} color={iconColor} />
      <span className="min-w-0 flex-1 truncate">{value}</span>
      <span className="text-[11px] text-ink-4">{caption}</span>
      <Icon name="pencil-outline" size={13} color="var(--m-ink-4)" />
    </button>
  );
}
