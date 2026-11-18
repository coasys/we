import type { TemplateSchema } from '@we/schema-shared';

/**
 * Every outcome in the mounted project, oldest first — the project's working list.
 *
 * Reads `AcornOutcome` directly: the fixture's three outcomes, or a mounted project's hundreds,
 * are the same query. v0 draws one line per outcome — content, status, task progress — where
 * S2-3 draws the tree and S2-4 the expanded card.
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
    {
      type: '$each',
      props: {
        items: { $query: { entity: 'AcornOutcome', order: { timestampCreated: 'asc' } } },
        as: 'outcome',
      },
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'baseline', p: '300', bg: 'surface', r: 'surface', width: '100%' },
          children: [
            { type: 'we-icon', props: { name: 'circle' } },
            {
              type: 'Column',
              props: { gap: '100', flex: '1 1 auto', minWidth: '0' },
              children: [
                {
                  type: 'we-text',
                  props: { fontWeight: 'medium' },
                  children: [{ $: 'outcome.content' }],
                },
                {
                  type: 'we-text',
                  props: { fontSize: 'sm', tone: 'secondary' },
                  children: [{ $: 'acornOutcomeSummary({ outcome: outcome })' }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
