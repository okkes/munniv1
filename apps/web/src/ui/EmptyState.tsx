import type { ReactNode } from 'react';
import { Icon } from './Icon';

interface EmptyStateProps {
  icon: string;
  text: string;
  /** primary action button(s), already wired */
  action?: ReactNode;
  testId?: string;
}

/** one-line empty state with the next step — never show a silent blank list */
export function EmptyState({ icon, text, action, testId }: EmptyStateProps) {
  return (
    <div className="flex flex-col items-center gap-3 px-6 py-12 text-center" data-testid={testId}>
      <Icon name={icon} size={34} color="var(--m-ink-4)" />
      <p className="max-w-[260px] text-[13px] text-ink-3">{text}</p>
      {action}
    </div>
  );
}
