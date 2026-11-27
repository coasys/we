/**
 * The effect summary as vectors: an operation's definition, what it may write (`execution.md`, "The
 * effect summary"), and what invoking it needs under one host's permission table ("Permission and
 * confirmation").
 *
 * The summary is the spec's, the same on every implementation. The permission is a host's: it maps
 * entities to that host's groups. Each file carries one table, so a second host can check its reading
 * of the rule against the reference: the format's file an example table over its neutral entities,
 * and WE's core file WE's own, which a test in the app shell holds WE's table to.
 * Under it, holding an operation needs the widest group an entity the summary names reaches (an
 * entity not in the table is in the default group); a category the summary names is an entity chosen
 * at call time, judged then, and is listed under `chosen` rather than widening the group.
 *
 * The suite's own small cases, one for each rule, are the format's; every core operation has a case
 * of its own in WE's file.
 */
import type { OperationDefinition } from '@we/backend-shared';
import { effectSummary, type OperationEffects } from '@we/entities';
import { CORE_OPERATIONS } from '@we/entities/manifest';

/**
 * The table the format's cases are read through: an example host's, over the cases' neutral entities,
 * so a host checks its reading of the rule without adopting WE's groups.
 */
export const FORMAT_EFFECT_GROUPS = {
  default: 'content',
  width: ['content', 'reactions', 'settings', 'library'],
  entities: { Document: 'library', Reaction: 'reactions', ReactionType: 'reactions', Status: 'settings' } as Record<
    string,
    string
  >,
};

/** WE's permission table: entity to group, and the groups narrowest first. */
export const EFFECT_GROUPS = {
  default: 'content',
  width: ['content', 'signals', 'space-settings', 'agent', 'library'],
  entities: {
    AgentSettings: 'agent',
    InvolvementType: 'space-settings',
    MutedAgent: 'space-settings',
    ReadMarker: 'agent',
    RelationshipType: 'space-settings',
    Shape: 'space-settings',
    Signal: 'signals',
    SignalType: 'signals',
    Space: 'space-settings',
    SpaceLandmark: 'space-settings',
    SpacePreference: 'agent',
    SpaceTemplatePreference: 'agent',
    TaskState: 'space-settings',
    Template: 'library',
    Theme: 'library',
    TypeStyle: 'space-settings',
  } as Record<string, string>,
};

export interface EffectCase {
  id: string;
  note: string;
  operation: OperationDefinition;
  /** Operations the case's operation calls, by qualified name. */
  calls?: Record<string, OperationDefinition>;
}

export interface EffectPermission {
  group: string;
  chosen: string[];
  destructive: boolean;
  writes: boolean;
}

const op = (steps: unknown[], extra: Record<string, unknown> = {}) =>
  ({ description: 'A case.', steps, ...extra }) as unknown as OperationDefinition;
const id = { $: 'id' };
const kind = { $: 'kind' };

const SUITE_CASES: EffectCase[] = [
  {
    id: 'effects.one-create',
    note: 'one create: not bulk, not destructive, in the default group',
    operation: op([{ create: { entity: 'Item', fields: { kind: 'note' } } }]),
  },
  {
    id: 'effects.reads-only',
    note: 'a find and a check write nothing, so the operation is not a write',
    operation: op([{ find: { as: 'f', entity: 'Status' } }, { check: { condition: true, error: 'no' } }], {
      errors: { no: 'No.' },
    }),
  },
  {
    id: 'effects.loop-is-bulk',
    note: 'a create and a link inside a forEach make the operation bulk',
    operation: op([
      {
        forEach: {
          in: { $: 'items' },
          as: 'item',
          steps: [
            { create: { as: 'made', entity: 'Item', fields: { kind: 'note' } } },
            { link: { entity: 'Item', id, relation: 'children', target: { $: 'made.id' } } },
          ],
        },
      },
    ]),
  },
  {
    id: 'effects.parent',
    note: 'a create under a parent adds to the parent’s relation, under * when the parent names no entity',
    operation: op([
      { create: { entity: 'Reaction', fields: { value: 1 }, parent: { id, relation: 'reactions' } } },
      {
        create: {
          entity: 'Text',
          fields: { text: 'x' },
          parent: { id, relation: 'children', entity: 'Item' },
        },
      },
    ]),
  },
  {
    id: 'effects.widest-group',
    note: 'a write of a status beside an item needs settings, the wider of the two groups',
    operation: op([
      { create: { entity: 'Item', fields: { kind: 'post' } } },
      { update: { entity: 'Status', id, fields: { name: 'Done' } } },
    ]),
  },
  {
    id: 'effects.library',
    note: 'an edit of a document is the library’s, the widest group',
    operation: op([{ update: { entity: 'Document', id, fields: { name: 'x' } } }]),
  },
  {
    id: 'effects.delete-is-destructive',
    note: 'a delete makes the operation destructive',
    operation: op([{ delete: { entity: 'Item', id } }]),
  },
  {
    id: 'effects.delete-own',
    note: 'a delete of only the invoker’s own record is deleteOwn, and not destructive',
    operation: op([{ delete: { entity: 'Reaction', id, own: true } }]),
  },
  {
    id: 'effects.unlink',
    note: 'an unlink removes from a relation, and is destructive',
    operation: op([{ unlink: { entity: 'Item', id, relation: 'children', target: { $: 'card' } } }]),
  },
  {
    id: 'effects.set-relation',
    note: 'a setRelation adds and removes, and is destructive',
    operation: op([{ setRelation: { entity: 'Item', id, relation: 'children', targets: [] } }]),
  },
  {
    id: 'effects.set-relation-keep',
    note: 'a setRelation that keeps what it leaves out only adds, and is not destructive',
    operation: op([{ setRelation: { entity: 'Item', id, relation: 'children', targets: [], keep: true } }]),
  },
  {
    id: 'effects.relation-by-expression',
    note: 'a relation chosen by expression is recorded as *',
    operation: op([{ link: { entity: 'Item', id, relation: { $: 'relation' }, target: { $: 'card' } } }]),
  },
  {
    id: 'effects.one-of-names',
    note: 'an entity chosen among names records under each name, and the group is the widest of them',
    operation: op([{ update: { entity: kind, oneOf: ['Item', 'ReactionType'], id, fields: { $: 'fields' } } }]),
  },
  {
    id: 'effects.per-call-any',
    note: 'an entity chosen from any record type is chosen at call time: listed as the category, judged per call, adding nothing to the group',
    operation: op([{ delete: { entity: kind, oneOf: [{ category: 'any' }], id } }]),
  },
  {
    id: 'effects.per-call-blockable',
    note: 'a create of any block type records under the category, chosen at call time, beside a named write that sets the group',
    operation: op([
      { create: { as: 'post', entity: 'Item', fields: { kind: 'post' } } },
      {
        create: {
          entity: kind,
          oneOf: [{ category: 'blockable' }],
          fields: { $: 'fields' },
          parent: { id: { $: 'post.id' }, relation: 'children', entity: 'Item' },
        },
      },
    ]),
  },
  {
    id: 'effects.when-ignored',
    note: 'a step a when may skip is still counted: the summary says what the operation could write',
    operation: op([{ delete: { entity: 'Status', id }, when: false }]),
  },
  {
    id: 'effects.call',
    note: 'what a called operation writes is the caller’s, and a call from a loop makes it bulk',
    operation: op([
      { forEach: { in: { $: 'items' }, as: 'item', steps: [{ call: { operation: 'conformance.react' } }] } },
    ]),
    calls: {
      'conformance.react': op([
        { create: { entity: 'Reaction', fields: { value: 1 }, parent: { id, relation: 'reactions' } } },
      ]),
    },
  },
];

const CORE_CASES: EffectCase[] = Object.keys(CORE_OPERATIONS)
  .sort()
  .map((name) => ({
    id: `effects.core-${name}`,
    note: `WE’s core.${name}`,
    operation: CORE_OPERATIONS[name],
  }));

/** The format's cases, over neutral entities. */
export const EFFECT_CASES: EffectCase[] = SUITE_CASES;

/** WE's core operations, one case each, read through WE's table. */
export const CORE_EFFECT_CASES: EffectCase[] = CORE_CASES;

/** A case's summary, its callees resolved from the case and from WE's core operations. */
export function summaryOf(c: Pick<EffectCase, 'operation' | 'calls'>): OperationEffects {
  return effectSummary(c.operation, {
    operations: (name) =>
      c.calls?.[name] ?? (name.startsWith('core.') ? CORE_OPERATIONS[name.slice('core.'.length)] : undefined),
  });
}

/** What invoking it needs, read from the summary through the file's table by the spec's rule. */
export function permissionOf(summary: OperationEffects, groups = EFFECT_GROUPS): EffectPermission {
  let widest = 0;
  for (const entity of Object.keys(summary.entities))
    widest = Math.max(widest, groups.width.indexOf(groups.entities[entity] ?? groups.default));
  return {
    group: groups.width[widest],
    chosen: Object.keys(summary.categories).sort(),
    destructive: summary.destructive,
    writes: Object.keys(summary.entities).length > 0 || Object.keys(summary.categories).length > 0,
  };
}

/**
 * A file of effect vectors: the table, and per case its definition, callees, summary and permission.
 * `effects.json` holds the format's cases under the example table; `we-core/effects.json` WE's core
 * operations under WE's.
 */
export function recordEffects(profile: 'format' | 'we-core' = 'format') {
  const groups = profile === 'format' ? FORMAT_EFFECT_GROUPS : EFFECT_GROUPS;
  return {
    version: 1,
    groups,
    cases: (profile === 'format' ? EFFECT_CASES : CORE_EFFECT_CASES).map((c) => {
      const summary = summaryOf(c);
      return {
        id: c.id,
        note: c.note,
        operation: c.operation,
        ...(c.calls ? { calls: c.calls } : {}),
        summary,
        permission: permissionOf(summary, groups),
      };
    }),
  };
}
