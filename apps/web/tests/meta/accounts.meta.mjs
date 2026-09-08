export const FEATURE       = 'accounts';
export const FEATURE_LABEL = 'All accounts';

export const GROUPS = [
  {
    name: 'Accounts',
    tests: [
      {
        key: '16-accounts-list',
        title: 'Assets & liabilities list',
        desc: 'Settings → All accounts lists accounts grouped into Assets and Liabilities with balances and IBANs.',
        tags: ['state'],
      },
      {
        key: '17-accounts-add',
        title: 'Add manual account',
        desc: 'The + button opens the type grid; picking Cash Wallet shows the manual form (name + starting balance, comma decimals accepted). The new account appears in the list and in the Home total.',
        tags: ['state'],
        steps: [
          'Account type grid',
          'Manual account form',
          'List with new account',
        ],
      },
      {
        key: '18-accounts-edit',
        title: 'Rename and delete',
        desc: 'Tapping an account opens the edit sheet: rename persists; delete tombstones the account, removing it from the list and the Home total.',
        tags: ['state', 'edge-case'],
        steps: [
          'Renamed account in list',
          'List after deletion',
        ],
      },
    ],
  },
];
