/** every new space starts seeing this much history (arc 5 default:
 *  two months back — the create sheet hints "3 months at most") */
export const DEFAULT_HISTORY_MONTHS = 2;

/** local-date ISO string `months` months back — for history-start defaults */
export const isoMonthsAgo = (months: number): string => {
  const d = new Date();
  d.setMonth(d.getMonth() - months);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** the space identity palette — shared by the create sheet and the
 *  space settings screen (arc 4: creation grew the same editor) */
export const SPACE_ICONS = [
  'leaf', 'home-outline', 'account-group-outline', 'briefcase-outline', 'airplane', 'heart-outline',
  'piggy-bank-outline', 'cart-outline', 'star-outline', 'beach', 'paw', 'baby-carriage',
];
export const SPACE_COLORS = ['#08372B', '#3498DB', '#27AE60', '#9B59B6', '#E74C3C', '#F39C12', '#16A085', '#E91E63'];
