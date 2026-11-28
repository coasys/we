import type { OperationDefinition, OperationParam, OperationStep } from '@we/backend-shared';

import { InvolvementType } from '../InvolvementType';
import { TaskState } from '../TaskState';

/*
  The space's own writes: the vocabularies a community names (task states, reactions, kinds of
  connection, kinds of involvement), what an agent keeps privately about a space, and the settings
  on the space's record.

  ## Slugs, one rule

  A record a community names gets a slug, and the slug is what everything holding it stores: a task
  its state, an involvement its kind, a template the reaction it draws. So every create here derives
  it the same way, with `slug()` over the name unless the caller gives one, and every create refuses
  a slug the space already holds, retired records included, with the named error `slugTaken`. A
  refusal rather than a suffix, because a slug is read by people too: "blocked-2" is a second
  state nobody asked for, and the person who typed "Blocked" meant the one that is there, which is
  what the error tells them. A name with no letters or digits in it has no slug, and is refused with
  `noSlug`.

  The slug is also the record's identity (`identity: ['slug']` on the create), so its id derives from
  the entity and the slug, the same on every node. The check reads committed state and names the
  refusal in a person's words; the identity is what holds when it cannot see: two members naming the
  same thing at the same instant on two nodes write one record, not two, and a second create the
  check did not catch is refused as `recordExists`. So a slug names one record, and an edit by slug
  edits that one.
*/

/** The slug a create writes: the one given, else the name's. */
const SLUG = "trim(slug ?? '') != '' ? trim(slug) : slug(trim(name ?? ''))";

/**
 * The slug of a record whose slug is not a thing to choose separately — a task state, a kind of
 * involvement — since what a task or an involvement stores should read as the name it was given.
 */
const NAME_SLUG = 'slug(trim(name))';

/** What a create of a slug-named record shares: the slug, its check, and the two errors. */
const SLUG_ERRORS = {
  noSlug: 'That name needs a letter or a digit in it.',
  slugTaken: 'This space already has one called that.',
};

const uniqueSlug = (entity: string, slug = SLUG): OperationStep[] => [
  { check: { condition: { $: `${slug} != ''` }, error: 'noSlug' } },
  { find: { as: 'taken', entity, where: { slug: { $: slug } } } },
  { check: { condition: { $: 'count(taken) == 0' }, error: 'slugTaken' } },
];

const slugParam: OperationParam = {
  type: 'string',
  description: 'The identifier everything holding it stores. Derived from the name when not given.',
};

/** A list literal for an expression, from a manifest's own option list. */
const listOf = (values: readonly string[]) => `[${values.map((v) => `'${v}'`).join(', ')}]`;

const TASK_SEMANTICS = listOf(TaskState.unions!.semantic.values);
const INVOLVEMENT_SEMANTICS = listOf(InvolvementType.unions!.semantic.values);

/** The record a slug names, and the named error when the space has none. */
const bySlug = (entity: string, error: string): OperationStep[] => [
  { find: { as: 'named', entity, where: { slug: { $: 'slug' } }, limit: 1 } },
  { check: { condition: { $: 'count(named) > 0' }, error } },
];

/** The steps of an edit of the record `bySlug` found, given the expression naming it. */
const onNamed = (steps: (id: string) => OperationStep[]): OperationStep[] => steps('first(named)');

const editBySlug = (entity: string, fields: Record<string, { $: string }>): OperationStep => ({
  update: { entity, id: { $: 'first(named)' }, fields },
});

const retireParams = (what: string): Record<string, OperationParam> => ({
  slug: { type: 'string', required: true, description: `The ${what}’s slug.` },
  retired: { type: 'boolean', required: true, description: 'Withdrawn from use, or brought back.' },
});

/*
  One record per key, found or made, and changed: the shape of every per-agent record in the root
  dataset (a read marker per node, a preference per space). Every match is read, oldest first, so a
  doubled record — two devices that both read before either wrote — is healed by the next write
  rather than inherited: the oldest is kept and the rest go.

  `fields` are written on a create and an update alike; `key` only on a create, being what it was
  found by. The operation answers with the record's id and what it now holds for the key and the
  fields, so the caller can show the change without reading every record of the kind again.
*/
function upsertOne(
  entity: string,
  key: Record<string, { $: string }>,
  fields: Record<string, { $: string }>,
): { steps: OperationStep[]; returns: { $: string } } {
  const written = `{ ${Object.entries({ ...key, ...fields })
    .map(([name, value]) => `${name}: ${value.$}`)
    .join(', ')} }`;
  return {
    steps: [
      { find: { as: 'rows', entity, where: key, order: { createdAt: 'asc' } } },
      { create: { as: 'made', entity, fields: { ...key, ...fields } }, when: { $: 'count(rows) == 0' } },
      { update: { entity, id: { $: 'first(rows)' }, fields }, when: { $: 'count(rows) > 0' } },
      {
        forEach: {
          in: { $: 'slice(rows, 1)' },
          as: 'extra',
          steps: [{ delete: { entity, id: { $: 'extra' } } }],
        },
      },
    ],
    // What was written, and to which record — the kept one, or the one made.
    returns: { $: `merge({ id: count(rows) > 0 ? first(rows).id : made.id }, ${written})` },
  };
}

/** A list with one entry turned on or off, once: appended when on, every copy removed when off. */
const toggled = (list: string, entry: string, on: string) =>
  `${on} ? (${entry} in ${list} ? ${list} : concat(${list}, [${entry}])) : without(${list}, ${entry})`;

/**
 * An object of settings with one value written or, absent, withdrawn — and a group left empty gone.
 * The group is taken out by picking every other one: `put` with null would keep it, holding null.
 */
const settingWritten = (settings: string) => {
  const group = `put(${settings}[group], key, value)`;
  return `count(keys(${group})) > 0 ? put(${settings}, group, ${group}) : pick(${settings}, without(keys(${settings}), group))`;
};

const spaceParam: OperationParam = { type: 'string', required: true, description: 'The space record’s id.' };
const uuidParam: OperationParam = { type: 'string', required: true, description: 'The space’s dataset id.' };
const fallbackParam: OperationParam = {
  type: 'list',
  description:
    'What the space has while its community has not decided — written whole by the first change, so later defaults do not join a space that has.',
};

/** The space's own record, read once, for a setting worked out from what it holds now. */
const findSpace: OperationStep = { find: { as: 'record', entity: 'Space', where: { id: { $: 'space' } }, one: true } };

/** A stored list, or the fallback when the space has not decided (an empty list is a decision). */
const decided = (field: string) => `record.${field} ?? fallback ?? []`;

/** Write one list field on the space, and answer with the list written. */
function spaceList(field: string, next: string): Pick<OperationDefinition, 'steps' | 'returns'> {
  return {
    steps: [findSpace, { update: { entity: 'Space', id: { $: 'space' }, fields: { [field]: { $: next } } } }],
    returns: { $: next },
  };
}

const stateFields = {
  icon: { type: 'string', description: 'A glyph; empty clears it.' },
  color: { type: 'string', description: 'A colour; empty clears it.' },
} as const;

export const SPACE_OPERATIONS: Record<string, OperationDefinition> = {
  // ── Task states ────────────────────────────────────────────────────────────────────────────

  createTaskState: {
    description:
      'Name a state this community’s work moves through, refused when the space already has one by that name.',
    params: {
      name: { type: 'string', required: true, description: 'What the state is called.' },
      semantic: { type: 'string', description: `What it counts as, one of ${TASK_SEMANTICS}; open when not given.` },
      ...stateFields,
    },
    errors: { ...SLUG_ERRORS, notASemantic: 'That is not something a state can count as.' },
    steps: [
      { check: { condition: { $: `!semantic || semantic in ${TASK_SEMANTICS}` }, error: 'notASemantic' } },
      // The slug is the name's, always: what a task stores is not a thing to choose separately.
      ...uniqueSlug('TaskState', NAME_SLUG),
      {
        create: {
          as: 'made',
          entity: 'TaskState',
          identity: ['slug'],
          fields: {
            name: { $: 'trim(name)' },
            slug: { $: NAME_SLUG },
            semantic: { $: "semantic ?? 'open'" },
            color: { $: 'color' },
            icon: { $: 'icon' },
          },
        },
      },
    ],
    returns: { $: 'made' },
  },
  updateTaskState: {
    description:
      'Change a state the community has — its name, glyph, colour, what it counts as, and what moving into it asks for. The slug stays: it is what every task stores.',
    params: {
      slug: { type: 'string', required: true, description: 'The state’s slug.' },
      name: { type: 'string', description: 'A new name; empty or absent keeps the old one.' },
      ...stateFields,
      semantic: {
        type: 'string',
        description: `What it counts as, one of ${TASK_SEMANTICS}; anything else is ignored.`,
      },
      approvals: { type: 'number', description: 'How many must agree to a move into it.' },
      approverKind: {
        type: 'string',
        description: 'The involvement kind whose holders’ approval counts; empty for anybody’s.',
      },
      evidence: { type: 'json', description: 'What must be there first, as the state stores it; empty clears it.' },
    },
    errors: { unknownState: 'This space has no state by that slug.' },
    steps: [
      ...bySlug('TaskState', 'unknownState'),
      editBySlug('TaskState', {
        icon: { $: 'icon' },
        color: { $: 'color' },
        approvals: { $: 'approvals' },
        approverKind: { $: 'approverKind' },
        evidence: { $: 'evidence' },
      }),
      { ...editBySlug('TaskState', { name: { $: 'trim(name)' } }), when: { $: "trim(name ?? '') != ''" } },
      { ...editBySlug('TaskState', { semantic: { $: 'semantic' } }), when: { $: `semantic in ${TASK_SEMANTICS}` } },
    ],
  },
  addTaskStateEvidence: {
    description: 'Add one requirement to what a state asks to be there before work moves into it.',
    params: {
      slug: { type: 'string', required: true, description: 'The state’s slug.' },
      requirement: {
        type: 'object',
        required: true,
        description: 'One requirement as the state stores it: { entity, where?, via?, min? }.',
      },
    },
    errors: { unknownState: 'This space has no state by that slug.' },
    steps: [
      ...bySlug('TaskState', 'unknownState'),
      ...onNamed((id) => [
        {
          update: {
            entity: 'TaskState',
            id: { $: id },
            fields: { evidence: { $: `concat(${id}.evidence, [requirement])` } },
          },
        },
      ]),
    ],
  },
  removeTaskStateEvidence: {
    description: 'Take one requirement, by its position, out of what a state asks to be there first.',
    params: {
      slug: { type: 'string', required: true, description: 'The state’s slug.' },
      index: { type: 'number', required: true, description: 'Its position in the list, from 0.' },
    },
    errors: { unknownState: 'This space has no state by that slug.' },
    steps: [
      ...bySlug('TaskState', 'unknownState'),
      ...onNamed((id) => {
        const kept = `concat(slice(${id}.evidence, 0, index), slice(${id}.evidence, index + 1))`;
        // None left is no requirement at all, stored as nothing rather than as an empty list.
        return [
          {
            update: {
              entity: 'TaskState',
              id: { $: id },
              fields: { evidence: { $: `count(${kept}) > 0 ? ${kept} : ''` } },
            },
          },
        ];
      }),
    ],
  },
  setTaskStateRetired: {
    description: 'Withdraw a state from use, or bring it back, leaving the work in it as it is.',
    params: retireParams('state'),
    errors: { unknownState: 'This space has no state by that slug.' },
    steps: [...bySlug('TaskState', 'unknownState'), editBySlug('TaskState', { retired: { $: 'retired' } })],
  },
  reorderTaskStates: {
    description: 'Set the order the community reads its states in, by slug. A slug with no record is left out.',
    params: {
      space: spaceParam,
      slugs: { type: 'list', required: true, description: 'The states’ slugs, in the order wanted.' },
    },
    steps: [
      { find: { as: 'states', entity: 'TaskState' } },
      {
        setRelation: {
          entity: 'Space',
          id: { $: 'space' },
          relation: 'taskStates',
          targets: { $: 'distinct(slugs.map(s, states.find(t, t.slug == s)).filter(t, t).map(t, t.id))' },
        },
      },
    ],
    returns: { $: 'distinct(slugs.map(s, states.find(t, t.slug == s)).filter(t, t).map(t, t.id))' },
  },

  // ── Reactions, kinds of connection, kinds of involvement ──────────────────────────────────

  createSignalType: {
    description:
      'Name a kind of reaction members can give. A toggle runs 0 to 1 and a vote −1 to 1 whatever is asked, and each mode is read as one number its own way unless told otherwise.',
    params: {
      name: { type: 'string', required: true, description: 'What the reaction is called.' },
      slug: slugParam,
      description: { type: 'string' },
      icon: { type: 'string' },
      iconSecondary: { type: 'string', description: 'The glyph for the other end of a vote or a range.' },
      mode: { type: 'string', description: 'toggle, vote, rating or slider.' },
      rangeMin: { type: 'number' },
      rangeMax: { type: 'number' },
      step: { type: 'number' },
      aggregate: { type: 'string', description: 'count, mean, sum or median; the mode’s own when not given.' },
      semantic: { type: 'string' },
      allowChange: { type: 'boolean' },
    },
    errors: SLUG_ERRORS,
    steps: [
      ...uniqueSlug('SignalType'),
      {
        create: {
          as: 'made',
          entity: 'SignalType',
          identity: ['slug'],
          fields: {
            name: { $: 'trim(name)' },
            slug: { $: SLUG },
            description: { $: 'description' },
            icon: { $: 'icon' },
            iconSecondary: { $: 'iconSecondary' },
            mode: { $: 'mode' },
            rangeMin: { $: "mode == 'toggle' ? 0 : mode == 'vote' ? -1 : rangeMin" },
            rangeMax: { $: "mode == 'toggle' || mode == 'vote' ? 1 : rangeMax" },
            step: { $: 'step' },
            /*
              The manifest's default, count, is right for one mode in four: a rating counted is a
              number of voters where the stars say a score, and a vote counted reports three for and
              three against as six.
            */
            aggregate: {
              $: "aggregate ?? (mode == 'vote' ? 'sum' : mode == 'rating' || mode == 'slider' ? 'mean' : null)",
            },
            semantic: { $: 'semantic' },
            allowChange: { $: 'allowChange' },
          },
        },
      },
    ],
    returns: { $: 'made' },
  },
  createRelationshipType: {
    description: 'Name a kind of connection between two records, refused when the space already has one by that name.',
    params: {
      name: { type: 'string', required: true, description: 'What the connection is called.' },
      slug: slugParam,
      description: { type: 'string' },
      icon: { type: 'string' },
      color: { type: 'string' },
      inverseName: { type: 'string', description: 'What it is called read from the other end.' },
      directed: { type: 'boolean' },
    },
    errors: SLUG_ERRORS,
    steps: [
      ...uniqueSlug('RelationshipType'),
      {
        create: {
          as: 'made',
          entity: 'RelationshipType',
          identity: ['slug'],
          fields: {
            name: { $: 'trim(name)' },
            slug: { $: SLUG },
            description: { $: 'description' },
            icon: { $: 'icon' },
            color: { $: 'color' },
            inverseName: { $: 'inverseName' },
            directed: { $: 'directed' },
          },
        },
      },
    ],
    returns: { $: 'made' },
  },
  createInvolvementType: {
    description:
      'Name a kind of part somebody can have in a record — “Shepherd”, “Second pair of eyes” — refused when the space already has one by that name. Whether it is somebody’s own answer is fixed here.',
    params: {
      name: { type: 'string', required: true, description: 'What the part is called.' },
      semantic: {
        type: 'string',
        description: `What it means, one of ${INVOLVEMENT_SEMANTICS}; responsible otherwise.`,
      },
      reflexive: {
        type: 'boolean',
        description: 'An answer only its own agent gives, rather than something said about them.',
      },
      appliesTo: { type: 'string', description: 'The entities it is offered on, comma-separated; empty for all.' },
      ...stateFields,
    },
    errors: SLUG_ERRORS,
    steps: [
      ...uniqueSlug('InvolvementType', NAME_SLUG),
      {
        create: {
          as: 'made',
          entity: 'InvolvementType',
          identity: ['slug'],
          fields: {
            name: { $: 'trim(name)' },
            slug: { $: NAME_SLUG },
            semantic: { $: `semantic in ${INVOLVEMENT_SEMANTICS} ? semantic : 'responsible'` },
            reflexive: { $: 'reflexive == true' },
            appliesTo: { $: 'appliesTo' },
            icon: { $: 'icon' },
            color: { $: 'color' },
          },
        },
      },
    ],
    returns: { $: 'made' },
  },
  updateInvolvementType: {
    description:
      'Change a kind of involvement — its name, glyph, colour, meaning and where it is offered. The slug stays, and so does whether it is an answer.',
    params: {
      slug: { type: 'string', required: true, description: 'The kind’s slug.' },
      name: { type: 'string', description: 'A new name; empty or absent keeps the old one.' },
      ...stateFields,
      semantic: { type: 'string', description: `One of ${INVOLVEMENT_SEMANTICS}; anything else is ignored.` },
      appliesTo: { type: 'string', description: 'The entities it is offered on, comma-separated; empty for all.' },
    },
    errors: { unknownKind: 'This space has no kind of involvement by that slug.' },
    steps: [
      ...bySlug('InvolvementType', 'unknownKind'),
      editBySlug('InvolvementType', { icon: { $: 'icon' }, color: { $: 'color' }, appliesTo: { $: 'appliesTo' } }),
      { ...editBySlug('InvolvementType', { name: { $: 'trim(name)' } }), when: { $: "trim(name ?? '') != ''" } },
      {
        ...editBySlug('InvolvementType', { semantic: { $: 'semantic' } }),
        when: { $: `semantic in ${INVOLVEMENT_SEMANTICS}` },
      },
    ],
  },
  setInvolvementTypeRetired: {
    description:
      'Withdraw a kind of involvement from use, or bring it back, leaving everybody already holding it as they are.',
    params: retireParams('kind'),
    errors: { unknownKind: 'This space has no kind of involvement by that slug.' },
    steps: [...bySlug('InvolvementType', 'unknownKind'), editBySlug('InvolvementType', { retired: { $: 'retired' } })],
  },

  // ── What an agent keeps privately, in their own dataset ───────────────────────────────────

  markRead: {
    description: 'Say the invoker has read a record as of now: one marker per record, moved forward.',
    params: {
      node: { type: 'string', required: true, description: 'The record read.' },
      space: uuidParam,
    },
    ...upsertOne(
      'ReadMarker',
      { nodeId: { $: 'node' } },
      // ISO-8601 UTC, whose text order is time order: the marker is compared with createdAt as text.
      { spaceUuid: { $: 'space' }, lastReadAt: { $: 'invokedAt' } },
    ),
  },
  setAgentMuted: {
    description:
      'Mute an account for the invoker everywhere, or unmute it: one record per account while muted, none after.',
    params: {
      did: { type: 'string', required: true, description: 'The account.' },
      muted: { type: 'boolean', required: true, description: 'The state wanted.' },
      description: { type: 'string', description: 'Why, for the invoker’s own list.' },
    },
    steps: [
      { find: { as: 'rows', entity: 'MutedAgent', where: { did: { $: 'did' } }, order: { createdAt: 'asc' } } },
      {
        create: { entity: 'MutedAgent', fields: { did: { $: 'did' }, description: { $: 'description' } } },
        when: { $: 'muted && count(rows) == 0' },
      },
      {
        forEach: {
          in: { $: 'muted ? slice(rows, 1) : rows' },
          as: 'row',
          steps: [{ delete: { entity: 'MutedAgent', id: { $: 'row' } } }],
        },
      },
    ],
  },
  setSpaceTemplateOverride: preference(
    'Choose the template the invoker sees in one space, over the space’s default.',
    {
      template: { type: 'string', required: true, description: 'A template id, or the value that follows the space.' },
    },
    { templateId: { $: 'template' } },
  ),
  setSpaceThemeOverride: preference(
    'Choose the theme the invoker sees in one space, over the space’s default.',
    { theme: { type: 'string', required: true, description: 'A theme id, or the value that follows the space.' } },
    { themeId: { $: 'theme' } },
  ),
  setViewVisible: preference(
    'Show or hide one of a space’s sections for the invoker only.',
    {
      view: { type: 'string', required: true, description: 'The view id.' },
      visible: { type: 'boolean', required: true, description: 'The state wanted.' },
    },
    { hiddenViews: { $: toggled('(first(rows).hiddenViews ?? [])', 'view', '!visible') } },
  ),
  setModuleVisible: preference(
    'Show or hide a module for the invoker only, in one space.',
    {
      module: { type: 'string', required: true, description: 'The module id.' },
      visible: { type: 'boolean', required: true, description: 'The state wanted.' },
    },
    { mutedModules: { $: toggled('(first(rows).mutedModules ?? [])', 'module', '!visible') } },
  ),
  setMyModuleSetting: preference(
    'Write, or withdraw, the invoker’s own answer to one setting in one space.',
    {
      group: { type: 'string', required: true, description: 'The module or capability the setting belongs to.' },
      key: { type: 'string', required: true, description: 'The setting.' },
      value: { type: 'json', description: 'The answer; absent withdraws it, so the level has no opinion again.' },
    },
    { moduleSettings: { $: settingWritten('first(rows).moduleSettings') } },
  ),

  // ── The space's settings ──────────────────────────────────────────────────────────────────

  setModuleEnabled: {
    description: 'Turn a module on or off for the whole space.',
    params: {
      space: spaceParam,
      module: { type: 'string', required: true, description: 'The module id.' },
      on: { type: 'boolean', required: true, description: 'The state wanted.' },
      fallback: fallbackParam,
    },
    ...spaceList('enabledModules', toggled(`(${decided('enabledModules')})`, 'module', 'on')),
  },
  setViewEnabled: {
    description:
      'Add a section to the space, at the end, or take it out — for every member. Sections this host does not know stay where they are.',
    params: {
      space: spaceParam,
      view: { type: 'string', required: true, description: 'The view id.' },
      on: { type: 'boolean', required: true, description: 'The state wanted.' },
      fallback: fallbackParam,
    },
    ...spaceList('enabledViews', toggled(`(${decided('enabledViews')})`, 'view', 'on')),
  },
  reorderViews: {
    description: 'Put the space’s sections in a new order. Only reorders: a section not already on is left off.',
    params: {
      space: spaceParam,
      order: { type: 'list', required: true, description: 'The section ids, in the order wanted.' },
      fallback: fallbackParam,
    },
    ...spaceList('enabledViews', `order.filter(v, v in (${decided('enabledViews')}))`),
  },
  setWorkflowArchived: {
    description: 'Put a workflow away, or bring it back: the records in it still show and can still finish.',
    params: {
      space: spaceParam,
      workflow: { type: 'string', required: true, description: 'The workflow’s name.' },
      archived: { type: 'boolean', required: true, description: 'The state wanted.' },
    },
    ...spaceList('archivedWorkflows', toggled('(record.archivedWorkflows ?? [])', 'workflow', 'archived')),
  },
  setSpaceDefaultTemplate: {
    description: 'Choose the template members see when they open the space.',
    params: {
      space: spaceParam,
      template: {
        type: 'string',
        required: true,
        description: 'The template’s id, as the host lists it; empty leaves the choice to each member’s own default.',
      },
    },
    // Two presses before the first has landed: the second is what the space keeps.
    serial: { $: "'default template ' + space" },
    steps: [{ update: { entity: 'Space', id: { $: 'space' }, fields: { defaultTemplateId: { $: 'template' } } } }],
  },
  setSpaceDefaultTheme: {
    description: 'Choose the theme members see when they open the space.',
    params: {
      space: spaceParam,
      theme: {
        type: 'string',
        required: true,
        description: 'The theme’s id, as the host lists it; empty leaves the choice to each member’s own default.',
      },
    },
    serial: { $: "'default theme ' + space" },
    steps: [{ update: { entity: 'Space', id: { $: 'space' }, fields: { defaultThemeId: { $: 'theme' } } } }],
  },
  setSpaceImage: {
    description: 'Set the space’s avatar or its cover image, or take it away.',
    params: {
      space: spaceParam,
      field: { type: 'string', required: true, description: 'avatar or coverImage.' },
      image: {
        type: 'json',
        description:
          'The picture as the record stores a file — what the host made of the one the person chose; absent takes it away.',
      },
    },
    errors: { notAnImageField: 'A space has an avatar and a cover image, and nothing else to put a picture in.' },
    serial: { $: "'image ' + space + ' ' + field" },
    steps: [
      { check: { condition: { $: "field in ['avatar', 'coverImage']" }, error: 'notAnImageField' } },
      // '' is the clear: an absent field in an update is left as it was.
      {
        update: { entity: 'Space', id: { $: 'space' }, fields: { avatar: { $: "image ?? ''" } } },
        when: { $: "field == 'avatar'" },
      },
      {
        update: { entity: 'Space', id: { $: 'space' }, fields: { coverImage: { $: "image ?? ''" } } },
        when: { $: "field == 'coverImage'" },
      },
    ],
  },
  setSpaceModuleSetting: {
    description: 'Write, or withdraw, the community’s answer to one setting.',
    params: {
      space: spaceParam,
      group: { type: 'string', required: true, description: 'The module or capability the setting belongs to.' },
      key: { type: 'string', required: true, description: 'The setting.' },
      value: { type: 'json', description: 'The answer; absent withdraws it, so the level has no opinion again.' },
    },
    ...spaceList('moduleSettings', settingWritten('record.moduleSettings')),
  },
  setCollectionInterpretation: {
    description:
      'Change what one collection is interpreted for, for everyone in it: whether as it grows, and one model in or out of what it looks for.',
    params: {
      collection: { type: 'string', required: true, description: 'The collection.' },
      autoExtract: { type: 'boolean', description: 'Interpreted as it grows, or not; absent leaves it.' },
      entity: { type: 'string', description: 'A model to add or remove; absent leaves the list.' },
      on: { type: 'boolean', description: 'Whether the model is wanted.' },
      fallback: { type: 'list', description: 'What the collection looks for while it holds no list of its own.' },
    },
    steps: [
      { find: { as: 'record', entity: 'CollectionBlock', where: { id: { $: 'collection' } }, one: true } },
      {
        update: { entity: 'CollectionBlock', id: { $: 'collection' }, fields: { autoExtract: { $: 'autoExtract' } } },
        when: { $: 'autoExtract == true || autoExtract == false' },
      },
      {
        update: {
          entity: 'CollectionBlock',
          id: { $: 'collection' },
          fields: {
            extractionTargets: { $: toggled('(record.extractionTargets ?? fallback ?? [])', 'entity', 'on == true') },
          },
        },
        when: { $: 'entity' },
      },
    ],
  },
  updateSpaceMeta: {
    description:
      'Change what a space is called and says about itself, whether it is listed, and where it is — a new place replaces the old, and none takes it away.',
    params: {
      space: spaceParam,
      name: { type: 'string' },
      description: { type: 'string' },
      discovery: { type: 'string', description: 'listed or hidden.' },
      location: {
        type: 'object',
        description: '{ latitude, longitude, name?, city?, country?, countryCode? }, to set the place.',
      },
      clearLocation: { type: 'boolean', description: 'Take the place away.' },
    },
    steps: [
      findSpace,
      {
        update: {
          entity: 'Space',
          id: { $: 'space' },
          fields: { name: { $: 'name' }, description: { $: 'description' }, discovery: { $: 'discovery' } },
        },
      },
      // The space's own place only, never every place in the space: an event has one too.
      {
        delete: { entity: 'LocationBlock', id: { $: 'record.location' } },
        when: { $: '(location || clearLocation) && record.location' },
      },
      {
        create: {
          as: 'place',
          entity: 'LocationBlock',
          fields: {
            latitude: { $: 'location.latitude' },
            longitude: { $: 'location.longitude' },
            name: { $: 'location.name' },
            city: { $: 'location.city' },
            country: { $: 'location.country' },
            countryCode: { $: 'location.countryCode' },
          },
        },
        when: { $: 'location' },
      },
      {
        update: { entity: 'Space', id: { $: 'space' }, fields: { location: { $: 'place.id' } } },
        when: { $: 'location' },
      },
    ],
  },
  makeSpaceCollection: {
    description:
      'Make the one collection everything top-level in a new space hangs off, and name it the space’s own. A space that has one keeps it.',
    params: {
      space: spaceParam,
      autoExtract: { type: 'boolean', description: 'Whether it is interpreted as it grows.' },
      extractionTargets: { type: 'list', description: 'What it is interpreted for.' },
    },
    errors: { hasCollection: 'This space already has its collection.' },
    steps: [
      findSpace,
      // Exactly one per space: a second would split the space's content between them.
      { check: { condition: { $: '!record.root' }, error: 'hasCollection' } },
      {
        create: {
          as: 'root',
          entity: 'CollectionBlock',
          /*
            A feed: every member adds to it, so no one member's editor may reconcile it, and a
            response to anything in it lives in it too.
          */
          fields: {
            kind: 'channel',
            mode: 'feed',
            autoExtract: { $: 'autoExtract' },
            extractionTargets: { $: 'extractionTargets' },
          },
        },
      },
      { update: { entity: 'Space', id: { $: 'space' }, fields: { root: { $: 'root.id' } } } },
    ],
    returns: { $: 'root.id' },
  },
};

/** An operation on the invoker's one preference record for a space, in their own dataset. */
function preference(
  description: string,
  params: Record<string, OperationParam>,
  fields: Record<string, { $: string }>,
): OperationDefinition {
  const { steps, returns } = upsertOne('SpacePreference', { spaceUuid: { $: 'space' } }, fields);
  return { description, params: { space: uuidParam, ...params }, steps, returns };
}
