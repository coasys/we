/**
 * The other five showcase fixtures.
 *
 * Kept in one file because they share a cast and a set of decisions, and splitting them would put
 * five copies of the same four agents in five places. The Discord one lives alone because it is the
 * most structurally involved -- two levels of containment -- and is the worked example.
 *
 * Each is shaped to stress what its layout is actually judged on, not to demonstrate features:
 *
 * - **Twitter** -- replies threaded under a post, one long post beside several short, so the row
 *   rhythm has to survive a 3:1 length difference.
 * - **Instagram** -- a grid with an odd count, so the last row is short and the tile sizing shows.
 * - **YouTube** -- playlists holding videos of very different title lengths, which is where a card
 *   grid usually breaks.
 * - **Kanban** -- an empty column beside a full one, the case a board layout most often gets wrong.
 * - **Events** -- events spread across months, so date grouping and relative timestamps both show.
 */
import { ADA, BO, BOOST, CAST, CY, DEE, LIKE } from './cast';
import { PLATES, WIDE } from './images';
import type { Fixture } from './types';

export const twitterFixture: Fixture = {
  id: 'twitter',
  templateId: 'twitter',
  themeId: 'timeline',
  space: { name: 'The Timeline', description: 'Short thoughts, mostly about maps.' },
  agents: CAST,
  signalTypes: [LIKE, BOOST],
  presence: [{ did: ADA, path: '/' }, { did: DEE }],
  content: [
    {
      kind: 'post',
      id: 'twitter-post-long',
      author: ADA,
      createdAt: '2026-08-11T08:05:00.000Z',
      body: [
        'Spent the morning with the 1897 sheets and I keep coming back to the hachuring. Nobody draws slope like that now -- it is doing in ink what a hillshade does with a light source, and doing it by hand, per fell.',
        'The engraver had opinions about which side of the valley mattered. You can see it.',
      ],
      signals: [
        { slug: 'like', by: [BO, CY, DEE] },
        { slug: 'boost', by: [CY] },
      ],
      children: [
        {
          kind: 'reply',
          author: BO,
          createdAt: '2026-08-11T08:31:00.000Z',
          body: ['This is the most Ada sentence ever written and I mean that warmly.'],
          signals: [{ slug: 'like', by: [DEE] }],
        },
        {
          kind: 'reply',
          author: CY,
          createdAt: '2026-08-11T09:02:00.000Z',
          body: ['Scan. Please.'],
        },
      ],
    },
    {
      kind: 'post',
      author: BO,
      createdAt: '2026-08-10T19:40:00.000Z',
      body: ['Every flat map is wrong. Some are wrong on purpose. A few are wrong beautifully.'],
      signals: [{ slug: 'like', by: [ADA, DEE] }],
    },
    {
      kind: 'post',
      author: DEE,
      createdAt: '2026-08-10T12:15:00.000Z',
      body: ['Reminder that the archive closes at four on Fridays and I will not be reopening it for anyone.'],
    },
    {
      kind: 'post',
      author: CY,
      createdAt: '2026-08-09T16:00:00.000Z',
      body: ['Ridge walk on the 22nd. Waterproofs.'],
      signals: [{ slug: 'like', by: [ADA] }],
    },
  ],
  route: '/',
};

export const instagramFixture: Fixture = {
  id: 'instagram',
  templateId: 'instagram',
  space: { name: 'Field Notes', description: 'What we saw, where we saw it.' },
  agents: CAST,
  signalTypes: [LIKE],
  presence: [{ did: CY, path: '/' }],
  // Five, deliberately: an odd count leaves the last grid row short, which is where tile sizing and
  // gap handling stop being guesses.
  content: [
    {
      kind: 'post',
      author: ADA,
      createdAt: '2026-08-11T07:00:00.000Z',
      body: ['Western sheets, morning light.'],
      images: [{ src: PLATES[0], alt: 'Survey sheet detail', width: 800, height: 800 }],
      signals: [{ slug: 'like', by: [BO, CY, DEE] }],
    },
    {
      kind: 'post',
      author: CY,
      createdAt: '2026-08-10T14:20:00.000Z',
      body: ['Trig point, finally.'],
      images: [{ src: PLATES[1], alt: 'Trig point', width: 800, height: 800 }],
      signals: [{ slug: 'like', by: [ADA] }],
    },
    {
      kind: 'post',
      author: DEE,
      createdAt: '2026-08-09T11:11:00.000Z',
      body: ['Marginalia on a sheet nobody has requested since 1974.'],
      images: [{ src: PLATES[2], alt: 'Marginalia', width: 800, height: 800 }],
    },
    {
      kind: 'post',
      author: BO,
      createdAt: '2026-08-08T18:45:00.000Z',
      body: ['Projection argument, settled with a grapefruit.'],
      images: [{ src: PLATES[3], alt: 'Grapefruit globe', width: 800, height: 800 }],
      signals: [{ slug: 'like', by: [ADA, CY] }],
    },
    {
      kind: 'post',
      author: ADA,
      createdAt: '2026-08-07T09:30:00.000Z',
      body: ['The folding cases. Look at the folding cases.'],
      images: [{ src: PLATES[4], alt: 'Folding case', width: 800, height: 800 }],
      signals: [{ slug: 'like', by: [DEE] }],
    },
  ],
  route: '/',
};

export const youtubeFixture: Fixture = {
  id: 'youtube',
  templateId: 'youtube',
  space: { name: 'Cartography Club TV', description: 'Talks, walkthroughs, and one very long argument.' },
  agents: CAST,
  signalTypes: [LIKE],
  presence: [{ did: BO, path: '/' }],
  content: [
    {
      kind: 'playlist',
      title: 'Reading a Sheet',
      description: 'Start here if you have never held one.',
      children: [
        {
          kind: 'post',
          id: 'youtube-video-contours',
          author: ADA,
          createdAt: '2026-08-05T10:00:00.000Z',
          // A deliberately long title beside a two-word one: a card grid with a fixed thumbnail and
          // a variable title is where alignment usually gives up.
          body: ['Contours, hachures, and why the nineteenth century did it better than we do'],
          images: [{ src: WIDE[0], alt: 'Contours', width: 1280, height: 720 }],
          signals: [{ slug: 'like', by: [BO, CY] }],
        },
        {
          kind: 'post',
          author: CY,
          createdAt: '2026-08-03T10:00:00.000Z',
          body: ['Grid north'],
          images: [{ src: WIDE[1], alt: 'Grid north', width: 1280, height: 720 }],
        },
        {
          kind: 'post',
          author: DEE,
          createdAt: '2026-08-01T10:00:00.000Z',
          body: ['Handling and storage without ruining anything'],
          images: [{ src: WIDE[2], alt: 'Storage', width: 1280, height: 720 }],
          signals: [{ slug: 'like', by: [ADA] }],
        },
      ],
    },
    {
      kind: 'playlist',
      title: 'Arguments',
      description: 'Mercator, mostly.',
      children: [
        {
          kind: 'post',
          author: BO,
          createdAt: '2026-07-28T10:00:00.000Z',
          body: ['Ninety minutes on why your world map is lying to you'],
          images: [{ src: WIDE[3], alt: 'Projections', width: 1280, height: 720 }],
          signals: [{ slug: 'like', by: [ADA, CY, DEE] }],
        },
      ],
    },
  ],
  route: '/',
};

export const kanbanFixture: Fixture = {
  id: 'kanban',
  templateId: 'kanban',
  space: { name: 'Club Business', description: 'What needs doing before the exhibition.' },
  agents: CAST,
  signalTypes: [LIKE],
  presence: [{ did: DEE, path: '/board/kanban-exhibition' }],
  content: [
    {
      kind: 'board',
      id: 'kanban-exhibition',
      title: 'Exhibition',
      children: [
        {
          kind: 'column',
          title: 'To do',
          children: [
            {
              kind: 'post',
              author: DEE,
              createdAt: '2026-08-11T09:00:00.000Z',
              body: ['Condition-check the 1897 sheets before anything goes in a frame'],
            },
            {
              kind: 'post',
              author: ADA,
              createdAt: '2026-08-11T09:05:00.000Z',
              body: ['Write the wall text for the hachuring panel'],
              signals: [{ slug: 'like', by: [BO] }],
            },
            {
              kind: 'post',
              author: CY,
              createdAt: '2026-08-10T15:00:00.000Z',
              body: ['Borrow the flat files'],
            },
          ],
        },
        {
          kind: 'column',
          title: 'In progress',
          children: [
            {
              kind: 'post',
              author: BO,
              createdAt: '2026-08-09T11:00:00.000Z',
              body: ['Scanning -- about a third done, the folded ones are slow'],
              signals: [{ slug: 'like', by: [ADA, DEE] }],
            },
          ],
        },
        // Deliberately empty: a board where every column has cards never shows what an empty one
        // does to the layout, and that is the case boards most often get wrong.
        { kind: 'column', title: 'Blocked' },
        {
          kind: 'column',
          title: 'Done',
          children: [
            {
              kind: 'post',
              author: ADA,
              createdAt: '2026-08-02T10:00:00.000Z',
              body: ['Book the room'],
            },
          ],
        },
      ],
    },
  ],
  route: '/board/kanban-exhibition',
};

export const eventsFixture: Fixture = {
  id: 'events',
  templateId: 'events',
  themeId: 'retro',
  space: { name: 'Club Calendar', description: 'Walks, talks, and the AGM nobody enjoys.' },
  agents: CAST,
  signalTypes: [{ name: 'Going', slug: 'going', icon: 'check-circle', description: 'Count me in' }],
  presence: [{ did: ADA, path: '/' }],
  content: [
    {
      kind: 'event',
      author: CY,
      createdAt: '2026-08-01T10:00:00.000Z',
      body: [
        'Ridge walk -- Cumberland western fells. Meet 08:00 at the car park. Waterproofs, and something warm; last time was educational.',
      ],
      signals: [{ slug: 'going', by: [ADA, BO, DEE] }],
    },
    {
      kind: 'event',
      author: DEE,
      createdAt: '2026-08-04T10:00:00.000Z',
      body: [
        'Archive open evening. The 1897 sheets will be out of their cases, so: clean hands, no drinks, and do not fold anything.',
      ],
      signals: [{ slug: 'going', by: [ADA] }],
    },
    {
      kind: 'event',
      author: BO,
      createdAt: '2026-08-06T10:00:00.000Z',
      body: ['Projections evening. Bring a world map you dislike and explain why.'],
      signals: [{ slug: 'going', by: [CY, DEE] }],
    },
    {
      kind: 'event',
      author: ADA,
      createdAt: '2026-08-08T10:00:00.000Z',
      body: ['AGM. Brief, allegedly.'],
    },
  ],
  route: '/',
};
