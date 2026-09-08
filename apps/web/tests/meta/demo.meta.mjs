export const FEATURE       = 'demo';
export const FEATURE_LABEL = 'Demo User';

export const GROUPS = [
  {
    name: 'Demo Login & Data',
    tests: [
      {
        key: '06-demo-login',
        title: 'Continue as demo user',
        desc: 'Login gate offers "Continue as demo user"; entering seeds the on-device database (2 accounts, 100 transactions) and Home shows the €11,570.55 total.',
        tags: ['first-run'],
        steps: [
          'Login screen',
          'Home with seeded balance',
        ],
      },
      {
        key: '07-demo-tx-list',
        title: 'Seeded transaction list',
        desc: 'Transactions tab lists the bundled demo dataset grouped by day, with category icons and review badges.',
        tags: ['state'],
      },
      {
        key: '08-demo-signout',
        title: 'Sign out resets demo data',
        desc: 'Signing out of the demo wipes the on-device database entirely — the next demo login starts from the pristine dataset again.',
        tags: ['state', 'edge-case'],
        steps: [
          'Settings with sign out',
          'Back at login, demo database deleted',
        ],
      },
    ],
  },
];
