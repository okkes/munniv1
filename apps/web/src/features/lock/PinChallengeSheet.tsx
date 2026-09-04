import { useEffect, useState } from 'react';
import { useLang } from '@/i18n';
import { hashPin, readLockConfig, verifyBiometric } from './lock';
import { Button } from '@/ui/Button';
import { Sheet } from '@/ui/Sheet';

/**
 * #302 (user, generalizing #282's disarm): a protected action asks for
 * the app-lock PIN (auto-verifying from 4 digits, error after 8) or the
 * registered biometric. Hosts open it only when a lock config exists —
 * with none configured, the action is simply not protected.
 */
export function PinChallengeSheet({
  open,
  onOpenChange,
  title,
  body,
  onPass,
}: Readonly<{
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  body: string;
  onPass: () => void;
}>) {
  const { t } = useLang();
  const [pin, setPin] = useState('');
  const [error, setError] = useState(false);

  const pass = () => {
    onOpenChange(false);
    onPass();
  };
  const tryBiometric = async () => {
    const config = readLockConfig();
    if (config && (await verifyBiometric(config, title))) pass();
  };
  const onDigit = async (next: string) => {
    setPin(next);
    setError(false);
    const config = readLockConfig();
    if (!config || next.length < 4) return;
    if ((await hashPin(next, config.pinSalt)) === config.pinHash) pass();
    else if (next.length >= 8) setError(true);
  };
  useEffect(() => {
    if (!open) return;
    setPin('');
    setError(false);
    // the registered biometric answers hands-free where it exists
    if (readLockConfig()?.credentialId) void tryBiometric();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  return (
    <Sheet open={open} onOpenChange={onOpenChange} title={title} size="compact">
      <div className="flex flex-col gap-3 pt-1" data-testid="pin-challenge-sheet">
        <p className="text-[13px] leading-relaxed text-ink-2">{body}</p>
        <input
          data-testid="pin-challenge-pin"
          value={pin}
          onChange={(e) => void onDigit(e.target.value.replaceAll(/\D/g, '').slice(0, 8))}
          inputMode="numeric"
          type="password"
          autoComplete="off"
          placeholder={t('lock.pinPlaceholder')}
          className={`h-12 w-full rounded-input border border-line bg-surface px-4 text-center font-mono text-[18px] tracking-[0.4em] text-ink outline-none${error ? ' ring-1 ring-negative' : ''}`}
        />
        {error && (
          <p className="text-center text-[12px] text-negative" data-testid="pin-challenge-error">
            {t('lock.wrongPin')}
          </p>
        )}
        {readLockConfig()?.credentialId && (
          <Button variant="outline" data-testid="pin-challenge-bio" onClick={() => void tryBiometric()}>
            {t('lock.disarmBiometric')}
          </Button>
        )}
      </div>
    </Sheet>
  );
}
