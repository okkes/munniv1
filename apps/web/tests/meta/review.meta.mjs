export const FEATURE       = 'review';
export const FEATURE_LABEL = 'Transaction Review';

export const GROUPS = [
  {
    name: 'Review Queue',
    tests: [
      {
        key: '13-review-banner',
        title: 'Home banner opens the queue',
        desc: 'Home shows a review banner with the pending count (3 in demo); tapping it opens the review queue, newest transaction first.',
        tags: ['navigation', 'state'],
        steps: [
          'Home with review banner',
          'Review queue card',
        ],
      },
      {
        key: '14-review-flow',
        title: 'Confirm / recategorize through the queue',
        desc: 'Confirm keeps the suggested category; the chip opens the picker to choose a different one. Queue advances until the all-caught-up state.',
        tags: ['state'],
        steps: [
          'Second card after confirming',
          'Third card after recategorizing',
          'All caught up',
        ],
      },
      {
        key: '15-review-done',
        title: 'Empty queue hides the banner',
        desc: 'Once every transaction is reviewed, returning home no longer shows the review banner.',
        tags: ['state', 'edge-case'],
      },
    ],
  },
];
