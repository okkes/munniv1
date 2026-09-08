export const FEATURE       = 'categories';
export const FEATURE_LABEL = 'Categories';

export const GROUPS = [
  {
    name: 'Manage Categories',
    tests: [
      {
        key: '29-cats-manage',
        title: 'Catalog grouped by parent',
        desc: 'Settings → Categories lists the full catalog under colored parent headers; built-ins are read-only, custom ones get a badge and are editable.',
        tags: ['state'],
      },
      {
        key: '30-cats-create',
        title: 'Create a custom category and use it',
        desc: 'New category sheet: name, parent chips, icon grid. Custom categories are per-space synced rows, appear in the picker instantly, and can be assigned to transactions.',
        tags: ['state'],
        steps: [
          'Filled create sheet',
          'Custom category in the list',
          'Assigned to a transaction',
        ],
      },
      {
        key: '31-cats-edit',
        title: 'Edit and delete custom categories',
        desc: 'Custom categories can be renamed and deleted (tombstoned); transactions referencing a deleted category fall back to Uncategorized at render.',
        tags: ['state', 'edge-case'],
        steps: [
          'Renamed custom category',
          'Deleted from the list',
        ],
      },
    ],
  },
];
