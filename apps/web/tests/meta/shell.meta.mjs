export const FEATURE       = 'shell';
export const FEATURE_LABEL = 'App Shell';

export const GROUPS = [
  {
    name: 'Navigation',
    tests: [
      {
        key: '01-shell-home',
        title: 'Home tab (default)',
        desc: 'App boots to the Home tab with the bottom tab bar (mobile) and URL routed to #/home.',
        tags: ['first-run'],
      },
      {
        key: '02-shell-tabs',
        title: 'Tab navigation',
        desc: 'Tapping each tab switches screens: Transactions → Spaces → Settings.',
        tags: ['navigation'],
        steps: [
          'Transactions tab',
          'Spaces tab',
          'Settings tab',
        ],
      },
      {
        key: '03-shell-back',
        title: 'Browser back between tabs',
        desc: 'Every screen has a real URL, so the browser/device back button returns to the previous tab.',
        tags: ['navigation'],
        steps: [
          'Transactions tab opened',
          'Browser back → Home tab',
        ],
      },
    ],
  },
  {
    name: 'Appearance & Language',
    tests: [
      {
        key: '04-shell-language',
        title: 'Language switch (EN → NL)',
        desc: 'Settings → Language opens the shared bottom sheet; picking Nederlands relabels the whole UI.',
        tags: ['state'],
        steps: [
          'Settings screen',
          'Language sheet open',
          'UI in Dutch',
        ],
      },
      {
        key: '05-shell-dark',
        title: 'Dark mode toggle',
        desc: 'The Appearance row hosts a three-way segment (light / dark / auto); picking dark pins the warm-dark theme and persists in localStorage.',
        tags: ['state'],
      },
      {
        key: '38-offline',
        title: 'Offline mode lifecycle',
        desc: 'Create a fully local profile (zero network, ever): personal space named after it, accounts and transactions work offline, signing out keeps the data, and the profile is selectable again on the login screen.',
        tags: ['state', 'edge-case'],
        steps: [
          'Offline profile sheet',
          'Offline transaction added',
          'Data intact after sign-out and re-entry',
        ],
      },
    ],
  },
];
