import type { TemplateSchema } from '@we/schema-shared';

import { treeSection } from './tree.ts';
import { callPage, spaceRoutes } from './views.ts';

/**
 * A Coasys space: one tree and one view.
 *
 * The tree is a section in a home lane down the left — resizable from its inner edge, folded away
 * from its own header, and breakable out into a panel like any section. Beside it the view takes the
 * rest: a channel's chat or canvas, the flows, or a record's own page. A call's record has a page of
 * its own here; every other record gets the host's.
 *
 * On a narrow screen the lane takes the whole width, so the tree is what a phone opens on; folding it
 * shows the view.
 */
export const coasysSpace: TemplateSchema & { id: string } = {
  id: 'coasys-space',
  meta: {
    name: 'Coasys',
    description: 'A space as one tree and one view: its channels, calls, flows and people beside what you chose.',
    icon: 'tree-structure',
    requires: { modules: ['call', 'transcribe'] },
    // `grow` so the tree takes the lane's whole length and scrolls inside it, rather than stopping
    // where its rows do.
    panels: [{ id: 'tree', node: treeSection, title: 'This space', home: 'tree', snap: 'left', size: 'sm', grow: 1 }],
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
