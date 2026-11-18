import type { ModulePart } from '@we/module-shared';

/**
 * The Acorn parts, named for what they are — the set the later stages fill in.
 *
 * v0 stubs are honest stubs: `outcomeCard` and `expandedOutcome` draw one record's fields;
 * the list parts query the mounted classes directly. The map and dashboard are declarations
 * of intent — they exist so the module's surface is named in one place, not to pretend the
 * canvas landed early.
 *
 * Everything here reads `Acorn*` records through `$query` or declares its row as an `input`
 * — never a module store, which this module does not have.
 */
export const ACORN_PARTS: Record<string, ModulePart> = {
  outcomeCard: {
    label: 'Outcome card',
    description: 'One outcome — its content, and status/progress/scope as a line under it',
    subject: 'outcome',
    inputs: { outcome: { description: 'the AcornOutcome record this card draws' } },
    node: {
      type: 'Column',
      props: { gap: '100', p: '300', bg: 'surface', r: 'surface' },
      children: [
        { type: 'we-text', props: { fontWeight: 'medium' }, children: [{ $: 'outcome.content' }] },
        {
          type: 'we-text',
          props: { fontSize: 'sm', tone: 'secondary' },
          children: [{ $: 'acornOutcomeSummary({ outcome: outcome })' }],
        },
      ],
    },
  },
  expandedOutcome: {
    label: 'Expanded outcome',
    description: 'One outcome, full: content, description, tasks, estimate and time frame',
    subject: 'outcome',
    inputs: { outcome: { description: 'the AcornOutcome record shown expanded' } },
    node: {
      type: 'Column',
      props: { gap: '300', p: '400' },
      children: [
        { type: 'we-text', props: { fontSize: 'xl', fontWeight: 'bold' }, children: [{ $: 'outcome.content' }] },
        { type: 'we-text', children: [{ $: 'outcome.description' }] },
        {
          type: 'we-text',
          props: { tone: 'secondary' },
          children: [{ $: 'acornOutcomeSummary({ outcome: outcome })' }],
        },
        {
          type: 'we-text',
          props: { tone: 'secondary' },
          children: [{ $: 'acornTimeFrameLabel({ timeFrame: outcome.timeFrame })' }],
        },
      ],
    },
  },
  outcomeTable: {
    label: 'Outcome table',
    description: 'Every outcome in the project as a row — content, scope, status, progress',
    node: {
      type: 'Column',
      props: { gap: '200', width: '100%' },
      children: [
        {
          type: '$each',
          props: { items: { $query: { entity: 'AcornOutcome', order: { content: 'asc' } } }, as: 'outcome' },
          children: [
            {
              type: 'Row',
              props: { gap: '400', p: '300', borderBottom: '1px solid border', width: '100%' },
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
              ],
            },
          ],
        },
      ],
    },
  },
  priorityList: {
    label: 'Priority list',
    description: "The project's top-priority outcomes, in the order AcornProjectMeta left them",
    node: {
      type: 'Column',
      props: { gap: '200', width: '100%' },
      children: [
        {
          type: '$each',
          props: {
            items: { $query: { entity: 'AcornProjectMeta', include: { topPriorityOutcomes: true } } },
            as: 'meta',
          },
          children: [
            {
              type: '$each',
              props: { items: { $: 'meta.topPriorityOutcomes' }, as: 'priority' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '300', p: '300', bg: 'surface', r: 'surface', width: '100%' },
                  children: [
                    { type: 'we-text', props: { tone: 'secondary' }, children: [{ $: 'index + 1' }] },
                    { type: 'we-text', props: { fontWeight: 'medium' }, children: [{ $: 'priority.content' }] },
                  ],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  projectDashboard: {
    label: 'Project dashboard',
    description: 'The mounted projects — one card per AcornProjectMeta, its member roster under S2-5',
    node: {
      type: 'Column',
      props: { gap: '300', width: '100%' },
      children: [
        {
          type: '$each',
          props: { items: { $query: { entity: 'AcornProjectMeta' } }, as: 'meta' },
          children: [
            {
              type: 'Column',
              props: { gap: '100', p: '300', bg: 'surface', r: 'surface' },
              children: [
                { type: 'we-text', props: { fontWeight: 'semibold' }, children: [{ $: 'meta.name' }] },
                {
                  type: 'we-text',
                  props: { fontSize: 'sm', tone: 'secondary' },
                  children: [{ $: '`Layering: ${meta.layeringAlgorithm}`' }],
                },
              ],
            },
          ],
        },
      ],
    },
  },
  mapView: {
    label: 'Outcome map',
    description: 'The outcome tree as a zoomable map — a stub until the canvas lands in S2-8',
    node: {
      type: 'Column',
      props: { gap: '300', width: '100%' },
      children: [
        { type: 'we-text', props: { tone: 'secondary' }, children: ['The outcome-tree canvas lands in S2-8.'] },
        {
          type: '$each',
          props: { items: { $query: { entity: 'AcornOutcome', order: { timestampCreated: 'asc' } } }, as: 'outcome' },
          children: [{ type: 'we-text', props: { fontWeight: 'medium' }, children: [{ $: 'outcome.content' }] }],
        },
      ],
    },
  },
};
