import type { TemplateSchema } from '@we/schema-shared';

/**
 * The project's priority list — the outcomes `AcornProjectMeta.topPriorityOutcomes` orders.
 *
 * Acorn keeps priority as a relation on the project meta rather than a field on the outcome,
 * so this reads the meta and expands its list. Drag-to-reorder lands with writes in S2-7;
 * here the list is the record, in the order it was left.
 */
export const acornPriorityView: TemplateSchema = {
  meta: {
    name: 'Priority',
    description: "The project's top-priority outcomes, in the order the project left them",
    icon: 'medal',
    role: 'view',
    segment: 'priority',
    requires: { modules: ['acorn'] },
  },
  type: 'Column',
  props: { p: '500', gap: '300', width: '100%', maxWidth: 'var(--we-layout-lg)', mx: 'auto' },
  children: [
    {
      type: 'we-text',
      props: { fontSize: 'xl', fontWeight: 'bold' },
      children: ['Priority'],
    },
    {
      type: '$each',
      props: {
        items: {
          $query: { entity: 'AcornProjectMeta', include: { topPriorityOutcomes: true } },
        },
        as: 'meta',
      },
      children: [
        {
          type: '$each',
          props: { items: { $: 'meta.topPriorityOutcomes' }, as: 'priority' },
          children: [
            {
              type: 'Row',
              props: { gap: '300', ay: 'center', p: '300', bg: 'surface', r: 'surface', width: '100%' },
              children: [
                { type: 'we-text', props: { tone: 'secondary' }, children: [{ $: 'index + 1' }] },
                {
                  type: 'we-text',
                  props: { fontWeight: 'medium' },
                  children: [{ $: 'priority.content' }],
                },
              ],
            },
          ],
        },
      ],
    },
  ],
};
