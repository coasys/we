/**
 * Wheres the absent-value audit has to find, beside the same wheres written so they do not count on
 * an absent value matching. `absentAudit.test.ts` runs the audit over this file alone.
 */
import type { SchemaNode } from '../../../src';

/** Each of these kept rows without the field before `filter()` read the where as a `$query` does. */
export const planted: SchemaNode = {
  type: 'Column',
  children: [
    { type: 'we-text', children: [{ $: "count(filter(local.tasks, { plantedAssignee: { not: 'Ann' } }))" }] },
    { type: 'we-text', children: [{ $: "local.tasks.find({ plantedStatus: { not: ['done', 'dropped'] } }).id" }] },
    { type: 'we-text', children: [{ $: "count(filter(local.tasks, { plantedTitle: '' }))" }] },
    { type: 'we-text', children: [{ $: 'count(filter(local.tasks, { plantedName: { contains: local.search } }))' }] },
    // Inside a NOT, and nested in another call, it is still a where of a filter().
    {
      type: 'we-text',
      children: [{ $: "count(first([filter(local.tasks, { NOT: { plantedNested: { not: 'x' } } })]))" }],
    },
  ],
};

/** The same questions, asked so an absent value is accounted for. */
export const fixed: SchemaNode = {
  type: 'Column',
  children: [
    {
      type: 'we-text',
      children: [
        {
          $: "count(filter(local.tasks, { OR: [{ fixedAssignee: { not: 'Ann' } }, { fixedAssignee: { exists: false } }] }))",
        },
      ],
    },
    { type: 'we-text', children: [{ $: 'count(filter(local.tasks, { fixedTitle: { exists: false } }))' }] },
    {
      type: 'we-text',
      children: [{ $: 'count(filter(local.tasks, local.search ? { fixedName: { contains: local.search } } : {}))' }],
    },
    {
      type: 'we-text',
      children: [
        { $: 'trim(local.search) ? filter(local.tasks, { fixedLabel: { contains: local.search } }) : local.tasks' },
      ],
    },
    { type: 'we-text', children: [{ $: "count(filter(local.tasks, { fixedLiteral: { contains: 'urgent' } }))" }] },
  ],
};
