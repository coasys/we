import type { TemplateSchema } from '@we/schema-shared';

/**
 * The outcomes as a table — Acorn's table view (`TableView` → `OutcomeTableWithFilters`).
 *
 * The module's `acorn.outcomeTable` part draws it: the outcome tree depth-first with Acorn's ID
 * numbers, computed scope and status, progress and tags, under Acorn's filters (S2-6). A row
 * opens the expanded outcome, as it does in Acorn.
 */
export const acornOutcomeTableView: TemplateSchema = {
  meta: {
    name: 'Table',
    description: 'Every outcome as a row of the tree — ID, scope, status, progress and tags — with filters',
    icon: 'table',
    role: 'view',
    segment: 'table',
    requires: { modules: ['acorn'] },
  },
  // The section wears Acorn itself, so it looks the same inside any shell.
  theme: { themeName: 'acorn' },
  type: 'Column',
  props: { 'data-acorn-view': 'table', bg: 'page', minHeight: '100%', p: '500', gap: '300', width: '100%' },
  children: [
    {
      type: 'we-text',
      props: { fontSize: '600', fontWeight: 'bold' },
      children: ['Table'],
    },
    { type: '$part', props: { id: 'acorn.outcomeTable' } },
  ],
};
