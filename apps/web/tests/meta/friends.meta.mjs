export const FEATURE       = 'friends';
export const FEATURE_LABEL = 'Friends';

export const GROUPS = [
  {
    name: 'Friends (real API)',
    tests: [
      {
        key: '32-friends',
        title: 'Request → accept between two users',
        desc: 'Two real users against the API: Alice shares her user ID, Bob sends a request with it, Alice accepts, both see each other as friends. Friends are the prerequisite for shared-space invites.',
        tags: ['state'],
        steps: [
          'Alice: her ID ready to share',
          'Bob: request sent',
          'Alice: accepted — friend listed',
          'Bob: friendship confirmed',
        ],
      },
    ],
  },
];
