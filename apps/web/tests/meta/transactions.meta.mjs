export const FEATURE       = 'transactions';
export const FEATURE_LABEL = 'Transactions';

export const GROUPS = [
  {
    name: 'Transaction Detail',
    tests: [
      {
        key: '09-tx-detail',
        title: 'Detail opens and back returns',
        desc: 'Tapping a row opens the detail screen (amount hero, category, account, bank description, notes); browser back returns to the list.',
        tags: ['navigation'],
        steps: [
          'Detail screen',
          'Back to list',
        ],
      },
      {
        key: '10-tx-recat',
        title: 'Recategorize clears review flag',
        desc: 'The category row opens the picker sheet; choosing a category updates the transaction and clears the needs-review badge.',
        tags: ['state'],
        steps: [
          'Category picker sheet',
          'Detail with new category',
        ],
      },
      {
        key: '11-tx-cat-search',
        title: 'Category picker search',
        desc: 'Typing in the picker search filters categories across all groups.',
        tags: ['state'],
      },
      {
        key: '12-tx-notes',
        title: 'Notes persist',
        desc: 'Notes save on blur into the local database and survive leaving and reopening the transaction.',
        tags: ['state'],
      },
    ],
  },
  {
    name: 'Manual Transactions',
    tests: [
      {
        key: '27-tx-create',
        title: 'Add a manual transaction',
        desc: 'The + button opens the form: sign toggle, amount (EU decimals), name, date, account chips, category picker. Saved transactions appear in the list immediately.',
        tags: ['state'],
        steps: [
          'Filled form',
          'New transaction in the list',
        ],
      },
      {
        key: '28-tx-edit',
        title: 'Edit a manual transaction',
        desc: 'Manual transactions get a pencil in the detail header; amount, name, date, account and category are editable. Bank-imported rows stay read-only (their data is the bank’s truth).',
        tags: ['state', 'edge-case'],
      },
      {
        key: '34-tx-reimburse',
        title: 'Link a reimbursement',
        desc: 'Expenses can link credit transactions as (partial) reimbursements: amounts are clamped to what is possible, the hero shows the net cost with the gross struck through, and unlinking restores it.',
        tags: ['state'],
      },
      {
        key: '35-tx-type-link',
        title: 'Counter-account locks the type',
        desc: 'Linking a counter-account makes the leg a plain Transfer with the locked Transfer out/in category — the special story (saving, debt) lives on the counter account’s own ledger; unlinking restores free typing.',
        tags: ['state', 'edge-case'],
      },
      {
        key: '36-tx-split',
        title: 'Split across categories',
        desc: 'The split editor partitions a transaction across categories — amounts must sum exactly (remainder chip auto-balances), the largest slice becomes the primary category, and clearing restores a single category.',
        tags: ['state'],
        steps: [
          'Balanced split editor',
          'Detail with breakdown',
        ],
      },
    ],
  },
];
