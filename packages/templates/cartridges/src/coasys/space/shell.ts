import type { TemplateSchema } from '@we/schema-shared';

import { treeSection } from './tree.ts';
import { callPage, spaceRoutes } from './views.ts';

/**
 * A Coasys space: one tree and one view.
 *
 * The tree is a section in a home lane down the left — resizable from its inner edge and folded away
 * from its own header. It is `fixed`, not breakable out into a panel: it is the space's only section,
 * so a tree floating free has nowhere to go but back, and leaves its lane empty meanwhile. Beside it
 * the view takes the rest: a channel's chat or canvas, the workflows, or a record's own page. A call's record has a page of
 * its own here; every other record gets the host's.
 *
 * On a narrow screen the lane takes the whole width, so the tree is what a phone opens on; folding it
 * shows the view.
 */
export const coasysSpace: TemplateSchema & { id: string } = {
  id: 'coasys-space',
  meta: {
    name: 'Coasys',
    description: 'A space as one tree and one view: its channels, calls, workflows and people beside what you chose.',
    icon: 'tree-structure',
    requires: { modules: ['call', 'transcribe'] },
    // `grow` so the tree takes the lane's whole length and scrolls inside it, rather than stopping
    // where its rows do. `fixed`: see above.
    panels: [
      {
        id: 'tree',
        node: treeSection,
        title: 'This space',
        home: 'tree',
        snap: 'left',
        size: 'sm',
        grow: 1,
        fixed: true,
      },
    ],
    recordViews: { 'CollectionBlock:call': callPage },
  },
  type: 'Row',
  props: { bg: 'page', width: '100%', height: '100%' },
  children: [
    { type: '$panels', props: { lane: 'tree', width: '280px', minWidth: '220px', maxWidth: '440px', resize: 'end' } },
    {
      type: 'Column',
      props: { flex: '1', minWidth: '0', height: '100%' },
      children: [{ type: '$routes' }],
    },
  ],
  routes: spaceRoutes,
};
