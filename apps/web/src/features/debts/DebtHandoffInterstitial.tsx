import { useEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { useLang } from '@/i18n';
import { Button } from '@/ui/Button';
import { MINA_EXPR } from '@/features/mina/assets';

/**
 * Fullscreen Mina moment between the recurring form's Debt chip and debt
 * creation (user redesign 2026-07-29: the in-screen note ended up hidden
 * behind the auto-opened create sheet). She explains why a payoff cost
 * is a debt, then the user chooses — continue into debt creation, or
 * stay a recurring cost. z-130 clears the sheet stack (Sheet portals at
 * z-50), matching the Mina fullscreen precedent.
 */
export function DebtHandoffInterstitial({ onContinue, onStay }: Readonly<{ onContinue: () => void; onStay: () => void }>) {
  const { t } = useLang();
  // browser back = "stay" (standing rule: every sub-flow answers the
  // back button). The Stay button closes directly; its leftover history
  // entry shares this URL, so the next back press consumes it invisibly.
  const stayRef = useRef(onStay);
  stayRef.current = onStay;
  useEffect(() => {
    window.history.pushState({ minaDebtHandoff: true }, '');
    const onPop = () => stayRef.current();
    window.addEventListener('popstate', onPop);
    return () => window.removeEventListener('popstate', onPop);
  }, []);
  return createPortal(
    <div
      className="fixed inset-0 z-[130] flex flex-col items-center justify-center overflow-y-auto bg-bg px-6"
      style={{ paddingTop: 'max(env(safe-area-inset-top, 0px), 12px)' }}
      data-testid="mina-debt-handoff"
    >
      <div className="flex w-full max-w-[420px] flex-col items-center text-center">
        <img src={MINA_EXPR.thinking} alt="Mina" className="max-h-[38dvh] w-auto max-w-[240px] rounded-2xl object-contain" />
        <p className="mt-5 text-[19px] font-semibold text-ink">{t('mina.debtHandoff.t')}</p>
        <p className="mt-2 max-w-[360px] text-[14px] leading-relaxed text-ink-2">{t('mina.debtHandoff.b')}</p>
        <div className="mt-6 flex w-full max-w-[360px] flex-col gap-2">
          <Button data-testid="mina-debt-handoff-continue" onClick={onContinue}>
            {t('mina.debtHandoff.continue')}
          </Button>
          <Button variant="outline" data-testid="mina-debt-handoff-stay" onClick={onStay}>
            {t('mina.debtHandoff.stay')}
          </Button>
        </div>
      </div>
    </div>,
    document.body,
  );
}
