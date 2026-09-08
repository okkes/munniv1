import { Icon } from './Icon';
import { useLang } from '@/i18n';

/**
 * #234 (user): ONE search field for the whole app — a magnify lead and
 * a clear × the moment there is text. Every hand-rolled search input
 * converges here (the pattern started life in BrandIconPicker).
 */
export function SearchField({
  value,
  onChange,
  placeholder,
  testId,
  height = 'h-11',
  textSize = 'text-[15px]',
  className = '',
  onFocus,
}: Readonly<{
  value: string;
  onChange: (next: string) => void;
  placeholder?: string;
  testId: string;
  height?: 'h-10' | 'h-11' | 'h-12';
  textSize?: string;
  className?: string;
  onFocus?: () => void;
}>) {
  const { t } = useLang();
  return (
    <div className={`relative ${className}`}>
      <span className={`pointer-events-none absolute top-0 left-3 flex ${height} items-center`}>
        <Icon name="magnify" size={17} color="var(--m-ink-4)" />
      </span>
      <input
        data-testid={testId}
        // #312 r5 (user): search is the ONE surface where a scroll
        // dismisses the keyboard — the browse gesture means reading
        // results, not typing. Form fields keep their keyboard.
        data-search-dismiss=""
        value={value}
        onFocus={onFocus}
        onChange={(e) => onChange(e.target.value)}
        placeholder={placeholder}
        className={`${height} w-full rounded-input border border-line bg-surface pr-10 pl-10 ${textSize} text-ink outline-none placeholder:text-ink-4`}
      />
      {value.length > 0 && (
        <button
          aria-label={t('action.dismiss')}
          data-testid={`${testId}-clear`}
          onClick={() => onChange('')}
          className={`m-tap absolute top-0 right-1 flex ${height} w-9 items-center justify-center border-none bg-transparent`}
        >
          <Icon name="close-circle" size={16} color="var(--m-ink-4)" />
        </button>
      )}
    </div>
  );
}
