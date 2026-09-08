import { useState } from 'react';
import type { ReactNode } from 'react';
import { useLang } from '@/i18n';
import { Button } from './Button';
import { Sheet } from './Sheet';

/**
 * #164: screens with an explicit Save and a back button ask before
 * dropping edits — the screen hands over its real back function and
 * navigates only through the guarded one it gets back. Render `sheet`
 * once anywhere in the screen's tree.
 */
export function useDiscardGuard(dirty: boolean, back: () => void): { guardedBack: () => void; sheet: ReactNode } {
  const { t } = useLang();
  const [open, setOpen] = useState(false);
  // dirty is live screen STATE, not a behavior selector (S2301): the
  // guarded function is picked per render from what the draft looks like
  const guardedBack = dirty ? () => setOpen(true) : back;
  const sheet = (
    <Sheet open={open} onOpenChange={setOpen} title={t('sheet.discardTitle')} size="compact">
      <div className="flex flex-col gap-3 pt-1" data-testid="screen-discard">
        <p className="text-[13px] leading-relaxed text-ink-2">{t('sheet.discardBody')}</p>
        <Button data-testid="screen-discard-stay" onClick={() => setOpen(false)}>
          {t('sheet.keepEditing')}
        </Button>
        <Button
          variant="danger"
          data-testid="screen-discard-leave"
          onClick={() => {
            setOpen(false);
            back();
          }}
        >
          {t('sheet.discardConfirm')}
        </Button>
      </div>
    </Sheet>
  );
  return { guardedBack, sheet };
}
