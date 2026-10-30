/**
 * The Feed: everything said and written in a space, and what was found in it, in one stream.
 *
 * Every call's lines, what was typed outside any call, replies and bot messages, merged by time, with
 * a row for what extraction found or somebody made. A space feature rather than part of transcription,
 * where it began: it reads what the space holds, whoever wrote it, and writes messages of its own. It
 * meets the transcript in the graph — transcription writes a call's lines, the Feed reads them — and in
 * `@we/messages`, which both draw a line with; neither knows the other is installed.
 *
 * Placed two ways: as a panel beside whatever is on screen, and as a view a template makes a page of
 * (`feed.feedView`) — a space whose main screen is its Feed.
 */
import { defineModule, type ModuleHost, type ModuleStoreDeps } from '@we/module-shared';

import { feedPanel, feedView } from './Feed.schema';
import { createFeedStore } from './store';

export { type FeedFind, readFeedWindow } from './feed';
export { feedPanel, feedView } from './Feed.schema';
export { createFeedStore } from './store';

export const feedModule = defineModule({
  manifest: {
    id: 'feed',
    name: 'Feed',
    description: 'Everything said and written in a space, and what was found in it, in one stream.',
    icon: 'chats-circle',
    requires: {
      /*
        `records` to read the space and write messages into it; `interpretation` for what kinds of
        record an activity row groups, and which of them are still suggestions.
      */
      kernels: ['records', 'interpretation'],
    },
  },

  contributes: {
    parts: {
      feedView: {
        node: feedView,
        label: 'Feed',
        description: 'Everything said and written in the space, with a box to write into it, as a page.',
        // Kept live while it is drawn, as the panel is while it is open.
        whileShown: { show: 'watchFeed', hide: 'unwatchFeed' },
      },
    },

    panels: [
      {
        name: 'feed',
        title: 'Feed',
        icon: 'chats-circle',
        node: feedPanel,
        bid: { edge: 'right', size: 'md' },
        open: 'feedOpen',
        show: 'openFeed',
        close: 'closeFeed',
        order: 92,
      },
    ],

    settings: [
      /*
        Which way round this reader draws the Feed. Theirs alone, everywhere: how a list reads is a
        reading preference, and one member's choice must not turn a room's chat upside down for
        everybody else.
      */
      {
        key: 'timelineOrder',
        label: 'Newest messages',
        description: 'Where the newest line of the Feed is drawn.',
        type: 'enum',
        options: [
          { label: 'At the bottom', value: 'newestBottom' },
          { label: 'At the top', value: 'newestTop' },
        ],
        default: 'newestBottom',
        levels: ['agent'],
      },
    ],
  },

  createStore: (deps: ModuleStoreDeps) => createFeedStore(deps),
});

/** What a host calls to get the module. Fragments only, so it uses none of the host's components. */
export const createModule = (_host: ModuleHost) => feedModule;
