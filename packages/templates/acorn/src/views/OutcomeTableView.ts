import type { TemplateSchema } from '@we/schema-shared';

/**
 * The outcomes as a table — the project's fields in columns rather than a tree.
 *
 * v0: content, scope, status, task progress, estimate. Sorting, editing and the column set
 * the real Acorn table offers land with the model layer in S2-5.
 */
export const acornOutcomeTableView: TemplateSchema = {
  meta: {
    name: 'Table',
    description: 'Every outcome as a row — content, scope, status, progress and estimate',
    icon: 'table',
    role: 'view',
    segment: 'table',
    requires: { modules: ['acorn'] },
  },
  type: 'Column',
  props: { p: '500', gap: '200', width: '100%' },
  children: [
    {
      type: 'Row',
      props: { gap: '400', p: '300', borderBottom: '1px solid border', width: '100%' },
      children: [
        { type: 'we-text', props: { fontWeight: 'semibold', flex: '3 1 0' }, children: ['Outcome'] },
        { type: 'we-text', props: { fontWeight: 'semibold', flex: '1 1 0' }, children: ['Scope'] },
        { type: 'we-text', props: { fontWeight: 'semibold', flex: '1 1 0' }, children: ['Status'] },
        { type: 'we-text', props: { fontWeight: 'semibold', flex: '1 1 0' }, children: ['Tasks'] },
        { type: 'we-text', props: { fontWeight: 'semibold', flex: '1 1 0' }, children: ['Smalls'] },
      ],
    },
    {
      type: '$each',
      props: {
        items: { $query: { entity: 'AcornOutcome', order: { content: 'asc' } } },
        as: 'outcome',
      },
      children: [
        {
          type: 'Row',
          props: { gap: '400', p: '300', borderBottom: '1px solid border', width: '100%', ay: 'center' },
          children: [
            { type: 'we-text', props: { flex: '3 1 0' }, children: [{ $: 'outcome.content' }] },
            {
              type: 'we-text',
              props: { flex: '1 1 0', tone: 'secondary' },
              children: [{ $: 'acornScopeLabel({ scope: outcome.scopeType })' }],
            },
            {
              type: 'we-text',
              props: { flex: '1 1 0', tone: 'secondary' },
              children: [{ $: 'acornStatusLabel({ status: outcome.achievementStatus })' }],
            },
            {
              type: 'we-text',
              props: { flex: '1 1 0', tone: 'secondary' },
              children: [{ $: 'acornTaskProgress({ taskList: outcome.taskList })' }],
            },
            {
              type: 'we-text',
              props: { flex: '1 1 0', tone: 'secondary' },
              children: [{ $: 'outcome.smallsEstimate' }],
            },
          ],
        },
      ],
    },
  ],
};
