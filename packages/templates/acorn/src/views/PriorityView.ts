import type { TemplateSchema } from '@we/schema-shared';

/**
 * The project's priority list — the outcomes `AcornProjectMeta.topPriorityOutcomes` orders.
 *
 * Acorn keeps priority as a relation on the project meta rather than a field on the outcome,
 * so the module's `acorn.priorityList` part reads the meta and expands its list. Dragging a
 * row, or adding and removing one, writes the whole new list back to the meta (S2-7).
 */
export const acornPriorityView: TemplateSchema = {
  meta: {
    name: 'Priority',
    description: "The project's top-priority outcomes, in the order the project keeps them",
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
    { type: '$part', props: { id: 'acorn.priorityList' } },
  ],
};
