import type { TemplateSchema } from '@we/schema-shared';
import { inspectorPanel } from '@we/template-kit';

import { CALL, canvasPane } from './canvas.ts';
import { IN_CANVAS } from './paths.ts';
import { treeSection } from './tree.ts';
import { callPage, spaceRoutes } from './views.ts';

/**
 * A Coasys space: one tree and one view.
 *
 * The tree is a section in a home lane down the left — resizable from its inner edge and folded away
 * from its own header. It is `fixed`, not breakable out into a panel: it is the space's only section,
 * so a tree floating free has nowhere to go but back, and leaves its lane empty meanwhile. Beside it
 * the view takes the rest: in Page mode, the page of whatever the tree has chosen — the Feed, the
 * workflows, a person, a record's own page (a call's is this template's; every other record gets the
 * host's); in Canvas mode, the space's canvas with that chosen thing in focus.
 *
 * On a narrow screen the lane takes the whole width, so the tree is what a phone opens on; folding it
 * shows the view.
 *
 * The inspector is the same shape on the right: a section in a lane of its own, resizable from its
 * inner edge, holding the kit's inspector for whatever the address names (`card`, `cardType`) — a
 * card pressed on the canvas, a definition chosen in the tree or on the vocabulary map. Folded while
 * nothing is chosen, so it slides in when something is and out when it is closed; there in Page mode
 * too, beside whatever page is open.
 */

/** Put the inspector away: nothing chosen, so its lane folds. */
const CLOSE_INSPECTOR = [
  { $invoke: 'routeStore.setParam', args: ['card', ''] },
  { $invoke: 'routeStore.setParam', args: ['cardType', ''] },
];
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
      {
        id: 'inspector',
        node: inspectorPanel({
          call: { $: CALL },
          empty: 'Choose something in the tree, or on the canvas, to look inside it.',
          close: CLOSE_INSPECTOR,
        }),
        title: 'Inspector',
        home: 'inspector',
        snap: 'right',
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
      // Page or Canvas — see `canvas.ts`. The canvas is drawn here rather than as a route, so it stays
      // mounted while the tree's choice changes; the address still changes as the tree is used, and
      // the pages come back as they were when the mode does.
      children: [{ type: '$if', props: { condition: { $: IN_CANVAS }, then: canvasPane, else: { type: '$routes' } } }],
    },
    {
      type: '$panels',
      props: {
        lane: 'inspector',
        width: '340px',
        minWidth: '280px',
        maxWidth: '560px',
        resize: 'start',
        collapsed: { $: '!routeStore.params.card' },
      },
    },
  ],
  routes: spaceRoutes,
};
