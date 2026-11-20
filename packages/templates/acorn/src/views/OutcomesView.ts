import type { TemplateSchema } from '@we/schema-shared';

/**
 * Every outcome in the mounted project, oldest first — the project's working list.
 *
 * The list itself is the module's `acorn.outcomeList` part: `$query` on `AcornOutcome`
 * drawing content, notes and status per row, with the write affordances the mounted
 * `update`/`delete` call actions answer, and each row opens the `acorn.expandedOutcome` part
 * over the list to read and edit that one outcome. The tree arrives with the map work.
 */
export const acornOutcomesView: TemplateSchema = {
  meta: {
    name: 'Outcomes',
    description: "Every outcome in the mounted project — the tree's nodes as a working list",
    icon: 'tree-structure',
    role: 'view',
    segment: 'outcomes',
    requires: { modules: ['acorn'] },
  },
  type: 'Column',
  props: { p: '500', gap: '300', width: '100%', maxWidth: 'var(--we-layout-lg)', mx: 'auto' },
  children: [
    {
      type: 'we-text',
      props: { fontSize: 'xl', fontWeight: 'bold' },
      children: ['Outcomes'],
    },
    /*
      The module's own part: the outcome list is an acorn concern — its rows, its create
      box, its write affordances — published as `acorn.outcomeList` so a placer can put it
      anywhere, and placed here so the section and the part are the same list. The host's
      `resolveParts` stands the part in for this node before the renderer sees it.
    */
    { type: '$part', props: { id: 'acorn.outcomeList' } },
  ],
};
