import type { SchemaNode } from '@we/schema-shared';
import { SOCIAL_DNA_LABELS } from '@we/template-kit';

import type { Crumb } from './bar.ts';
import { DNA_FOCUS, showDna } from './paths.ts';

/**
 * The space's Social DNA, named once for the three places that draw it: the tree lists it, the Social
 * DNA page reads it as cards, and the canvas draws it as the vocabulary map. Each reads the same
 * lists, and the same focus from the address (`?dna=`).
 */

/** The vocabulary that lives in the space's records rather than in a store. Declare it where these are read. */
export const DNA_QUERIES = {
  signalTypes: { entity: 'SignalType', order: { name: 'asc' } },
  relationshipTypes: { entity: 'RelationshipType', order: { name: 'asc' } },
  topics: { entity: 'Topic', order: { name: 'asc' } },
};

/** One kind of definition: its key in a focus, where its rows are, and how each is drawn — over `def`. */
export interface DnaList {
  kind: string;
  /** The vocabulary map's bucket for it. */
  bucket: keyof typeof SOCIAL_DNA_LABELS;
  label: string;
  icon: string;
  items: string;
  itemIcon: string;
}

/** The space's own definitions, in the order the vocabulary settings show them. */
export const DNA_LISTS: DnaList[] = [
  {
    kind: 'signal',
    bucket: 'signals',
    icon: 'heart',
    items: 'local.signalTypes',
    itemIcon: "def.icon ? def.icon : 'heart'",
  },
  {
    kind: 'connection',
    bucket: 'connections',
    icon: 'arrows-left-right',
    items: 'local.relationshipTypes',
    itemIcon: "'arrows-left-right'",
  },
  {
    kind: 'state',
    bucket: 'states',
    icon: 'circle-half',
    items: 'spaceStore.taskStates',
    itemIcon: "def.icon ? def.icon : 'circle'",
  },
  {
    kind: 'involvement',
    bucket: 'kinds',
    icon: 'hand-waving',
    items: 'spaceStore.involvementTypes',
    itemIcon: "def.icon ? def.icon : 'user'",
  },
  { kind: 'topic', bucket: 'topics', icon: 'hash', items: 'local.topics', itemIcon: "'hash'" },
  {
    kind: 'model',
    bucket: 'models',
    icon: 'shapes',
    // Every kind of thing a record can be, WE's own and the community's: what the vocabulary map's
    // Models bucket holds, known by name, as the map knows them. Only the community's are Shapes.
    items:
      'recordStore.creatableEntities.map(k, { id: k.value, name: k.label, icon: k.icon, description: k.description })',
    itemIcon: "def.icon ? def.icon : 'dna'",
  },
].map((list) => ({ ...list, label: SOCIAL_DNA_LABELS[list.bucket as DnaList['bucket']] }) as DnaList);

/** The policy, which is rules in words rather than records: one a row, by its words. */
export const POLICY = { kind: 'policy', bucket: 'policy', label: SOCIAL_DNA_LABELS.policy, icon: 'scales' } as const;
export const POLICY_RULES = 'spaceStore.policy.sentences';

/** The focus, as `all` where the address names none — the Social DNA page reached without one. */
export const DNA_AT = `(${DNA_FOCUS} ? ${DNA_FOCUS} : 'all')`;
/** The kind in focus (`signal`), and the definition of it (its id, or a rule's words). */
export const DNA_KIND = `split(${DNA_AT}, '|')[0]`;
export const DNA_ID = `split(${DNA_AT}, '|')[1]`;

/** An expression reading one field of the kind in focus, from a table by kind. */
export const byKind = (field: (list: DnaList | typeof POLICY) => string, quote = true): string =>
  `{ ${[...DNA_LISTS, POLICY].map((list) => `${list.kind}: ${quote ? `'${field(list)}'` : field(list)}`).join(', ')} }[${DNA_KIND}]`;

/** The vocabulary map's bucket for the kind in focus. */
export const BUCKET = byKind((list) => list.bucket);

/**
 * A node of the vocabulary map, as the focus it stands for — so pressing it on the map moves the focus
 * there, as choosing its row in the tree does. `node` is an expression naming the graph's node. A
 * bucket is its kind, a definition its kind and id, a model its name, a rule its words; anything else
 * (what a definition is used for, a workflow) is nothing, and leaves the focus where it was.
 */
export const dnaFocusOf = (node: string): string => {
  const kind = `{ ${[...DNA_LISTS, POLICY].map((list) => `${list.bucket}: '${list.kind}'`).join(', ')} }[${node}.data.bucket]`;
  return [
    `!(${kind}) ? ''`,
    `: ${node}.type == 'vocabulary' ? ${kind}`,
    `: (${kind}) == 'model' ? 'model|' + ${node}.data.entity`,
    `: (${kind}) == 'policy' ? 'policy|' + ${node}.data.item`,
    `: ${node}.recordId ? (${kind}) + '|' + ${node}.recordId : ''`,
  ].join(' ');
};

/** The definition in focus, by name: a rule of the policy is its own words. */
const DEF_NAME = `${DNA_KIND} == 'policy' ? ${DNA_ID} : ${byKind((list) => ('items' in list ? list.items : '[]'), false)}.find(d, d.id == (${DNA_ID})).name`;

/** The crumbs a Social DNA focus shows: Social DNA, then the kind, then the definition — each a way back up. */
export const dnaCrumbs = (when = 'true'): Crumb[] => [
  { label: 'Social DNA', onClick: showDna("'all'"), when },
  { label: { $: byKind((list) => list.label) }, onClick: showDna(DNA_KIND), when: `(${when}) && ${DNA_AT} != 'all'` },
  { label: { $: `(${DEF_NAME}) ?? 'Definition'` }, when: `(${when}) && ${DNA_ID}` },
];

/** The model in focus as the community's Shape, where it is one of theirs — what its settings know it by. */
const MODEL_SHAPE = `shapeStore.spaceShapes.find(s, s.name == (${DNA_ID})).id`;

/**
 * Where the definitions are edited, from the bar of either view of them: the space's vocabulary
 * settings — at the model chosen, where it is one, since the inspector does not read a model.
 */
export const editDna: SchemaNode = {
  type: 'we-button',
  props: {
    variant: 'ghost',
    size: 'sm',
    onClick: {
      $invoke: 'shellStore.openSpaceSettings',
      args: ['vocabulary', { $: `${DNA_KIND} == 'model' ? (${MODEL_SHAPE}) ?? '' : ''` }],
    },
  },
  children: [{ type: 'we-icon', props: { name: 'pencil-simple' } }, 'Edit in settings'],
};
