/**
 * A community mid-conversation, for the channels template.
 *
 * Shaped to stress the things a Discord-like layout is actually judged on rather than to show the
 * feature list: consecutive messages from the same author (does the byline repeat?), a one-word
 * reply next to a three-paragraph one (does the row rhythm survive?), a message with several
 * reactions and one with none, and two categories where one holds a single channel.
 *
 * Timestamps are fixed rather than relative to now. A fixture whose content ages produces a
 * different screenshot every day, and "3 minutes ago" versus "2 hours ago" is a different width.
 */
import { ADA, BO, CAST, CY, DEE } from './cast';
import type { Fixture } from './types';

export const discordFixture: Fixture = {
  id: 'discord',
  templateId: 'discord',

  space: {
    name: 'Cartography Club',
    description: 'People who like maps more than is strictly reasonable.',
  },

  agents: CAST,

  signalTypes: [
    { name: 'Heart', slug: 'heart', icon: 'heart', semantic: 'like', description: 'Appreciation' },
    { name: 'Compass', slug: 'compass', icon: 'compass', description: 'This helped me find something' },
  ],

  // Ada is reading #general; Bo is in the space but on another page. Both matter: `onlineHere`
  // filters on the route, so a roster that ignores `path` would show the same faces everywhere.
  presence: [
    { did: ADA, path: '/channel/discord-general' },
    { did: CY, path: '/channel/discord-general' },
    { did: BO },
  ],

  content: [
    {
      kind: 'category',
      title: 'The Club',
      children: [
        {
          kind: 'channel',
          title: 'general',
          description: 'Anything and everything',
          children: [
            {
              kind: 'message',
              author: ADA,
              createdAt: '2026-08-11T09:14:00.000Z',
              body: [
                'Morning all. The 1897 survey sheets arrived and they are in much better shape than the listing suggested.',
              ],
              signals: [{ slug: 'heart', by: [BO, CY, DEE] }],
            },
            {
              kind: 'message',
              author: ADA,
              createdAt: '2026-08-11T09:14:40.000Z',
              body: ['Three of them have the original folding cases too.'],
            },
            {
              kind: 'message',
              author: BO,
              createdAt: '2026-08-11T09:21:00.000Z',
              body: ['Oh that is a genuinely good find. Which county?'],
            },
            {
              kind: 'message',
              author: ADA,
              createdAt: '2026-08-11T09:23:00.000Z',
              body: [
                'Cumberland, mostly the western sheets. There is a lovely bit of hachuring around the fells that I have not seen done that way anywhere else.',
                'Whoever engraved these was showing off, and I am entirely here for it.',
              ],
              signals: [{ slug: 'compass', by: [CY] }],
            },
            {
              kind: 'message',
              author: CY,
              createdAt: '2026-08-11T10:02:00.000Z',
              body: ['Scan them before you fold them back up, please. I will beg if necessary.'],
              signals: [{ slug: 'heart', by: [ADA] }],
            },
            {
              kind: 'message',
              author: DEE,
              createdAt: '2026-08-11T11:47:00.000Z',
              body: ['Seconded.'],
            },
          ],
        },
        {
          kind: 'channel',
          title: 'projections',
          description: 'Arguments about Mercator, mainly',
          children: [
            {
              kind: 'message',
              author: BO,
              createdAt: '2026-08-10T16:30:00.000Z',
              body: ['Reminder that every flat map is wrong and some are wrong on purpose.'],
              signals: [{ slug: 'heart', by: [ADA, DEE] }],
            },
            {
              kind: 'message',
              author: DEE,
              createdAt: '2026-08-10T17:05:00.000Z',
              body: ['This is why I only trust globes and even then not completely.'],
            },
          ],
        },
      ],
    },
    {
      kind: 'category',
      title: 'Field Work',
      children: [
        {
          kind: 'channel',
          title: 'expeditions',
          description: 'Where we are going and who is driving',
          children: [
            {
              kind: 'message',
              author: CY,
              createdAt: '2026-08-09T08:00:00.000Z',
              body: [
                'Pencilling in the ridge walk for the 22nd. Bring something waterproof and something warm; last time was educational.',
              ],
            },
          ],
        },
      ],
    },
  ],

  // `discord-general` is the deterministic id `general` gets -- see FixtureNode.id.
  route: '/channel/discord-general',
};
