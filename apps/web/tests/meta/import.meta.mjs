export const FEATURE       = 'import';
export const FEATURE_LABEL = 'Bank File Import';

export const GROUPS = [
  {
    name: 'CAMT.053 Import',
    tests: [
      {
        key: '19-import-preview',
        title: 'Preview matches accounts by IBAN',
        desc: 'Picking a CAMT.053 file parses it on-device and previews each statement: matched existing account (by IBAN) or "New account", with transaction counts.',
        tags: ['state'],
      },
      {
        key: '20-import-run',
        title: 'Import, auto-categorize, dedupe',
        desc: 'Import creates/updates accounts (closing balance applied), auto-categorizes via Dutch keyword rules (Jumbo → Grocery), flags unknown merchants for review, and re-importing the same file skips everything as duplicates.',
        tags: ['state', 'edge-case'],
        steps: [
          'Import result summary',
          'Transactions list with imported rows',
          'Re-import: all duplicates skipped',
        ],
      },
      {
        key: '21-import-invalid',
        title: 'Invalid file error',
        desc: 'A non-CAMT XML file shows a friendly error inside the sheet instead of importing anything.',
        tags: ['error', 'validation'],
      },
    ],
  },
];
