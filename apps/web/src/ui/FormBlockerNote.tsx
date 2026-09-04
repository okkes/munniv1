import { useEffect, useRef } from 'react';

/**
 * #195: primary buttons stay ENABLED; an invalid click surfaces this red
 * blocker line instead of a silently disabled control. r2 (user): the
 * note sits under the OFFENDING FIELD, and showing it scrolls it into
 * view — the first (only) visible note is the first thing to fix.
 */
export function FormBlockerNote({
  show,
  text,
  testId,
  className = '',
}: {
  readonly show: boolean;
  readonly text: string;
  readonly testId: string;
  readonly className?: string;
}) {
  const el = useRef<HTMLParagraphElement>(null);
  useEffect(() => {
    if (show && text) el.current?.scrollIntoView?.({ block: 'center', behavior: 'smooth' });
  }, [show, text]);
  if (!show || !text) return null;
  return (
    <p ref={el} className={`text-[12px] text-negative ${className}`.trim()} data-testid={testId}>
      {text}
    </p>
  );
}

/** Ring classes for the offending field while the blocker note is up. */
export const blockerRing = (bad: boolean): string => (bad ? ' ring-1 ring-negative' : '');
