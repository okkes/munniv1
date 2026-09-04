import { useEffect, useState } from 'react';
import { useLang } from '@/i18n';
import { Button } from './Button';
import { Sheet } from './Sheet';

/**
 * Destructive confirms share ONE shape (user request: an instantly
 * pressable Confirm right under Delete felt scary): a bottom sheet, the
 * consequences spelled out, and a short cooldown before Confirm arms so
 * a stray double-tap can never destroy anything.
 */
const DEFAULT_COOLDOWN = import.meta.env.MODE === 'test' ? 0 : 5;

export function DangerConfirmSheet({
  open,
  onOpenChange,
  title,
  body,
  confirmLabel,
  busy,
  error,
  onConfirm,
  testId,
  cooldown,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  confirmLabel?: string;
  busy?: boolean;
  error?: string | null;
  onConfirm: () => void;
  testId: string;
  /** seconds before Confirm arms — 0 for low-stakes deletes (user
   *  ruling: a single transaction never warrants the wait) */
  cooldown?: number;
}>) {
  const { t } = useLang();
  const wait = cooldown ?? DEFAULT_COOLDOWN;
  const [left, setLeft] = useState(wait);

  useEffect(() => {
    if (!open) return;
    setLeft(wait);
    if (wait === 0) return;
    const timer = setInterval(() => setLeft((v) => (v <= 1 ? 0 : v - 1)), 1000);
    return () => clearInterval(timer);
  }, [open, wait]);

  const label = confirmLabel ?? t('action.confirm');
  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} size="form">
      <div className="flex flex-col gap-4 pt-1">
        <p className="text-[14px] leading-relaxed text-ink-2" data-testid={`${testId}-body`}>
          {body}
        </p>
        {error && (
          <p className="text-[12px] text-negative" data-testid={`${testId}-error`}>
            {error}
          </p>
        )}
        <Button variant="danger" data-testid={`${testId}-confirm`} disabled={busy || left > 0} onClick={onConfirm}>
          {left > 0 ? `${label} (${left})` : label}
        </Button>
        <Button variant="outline" data-testid={`${testId}-cancel`} onClick={() => onOpenChange(false)}>
          {t('action.cancel')}
        </Button>
      </div>
    </Sheet>
  );
}
