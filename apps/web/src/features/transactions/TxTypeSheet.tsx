import type { TxType } from '@/db/types';

/**
 * Every technical type keeps a face (colors near the category palette,
 * not the brand). The 7-type picker itself is gone — the user chooses a
 * KIND (TxKindSheet) and the technical type derives — but read surfaces
 * (bulk peek, filter detail chips) still show the resolved member.
 */
export const TX_TYPE_VISUAL: Record<TxType, { icon: string; color: string }> = {
  expense: { icon: 'cart-outline', color: '#C0392B' },
  income: { icon: 'cash-plus', color: '#27AE60' },
  saving: { icon: 'piggy-bank-outline', color: '#16A085' },
  transfer: { icon: 'swap-horizontal', color: '#2980B9' },
  debtPayment: { icon: 'hand-coin-outline', color: '#D68910' },
  investment: { icon: 'chart-line', color: '#8E44AD' },
  funding: { icon: 'hand-coin', color: '#16A085' },
  adjustment: { icon: 'tune-variant', color: '#7F8C8D' },
};
