import type { SchemaNode } from '@we/schema-shared';
import { SOCIAL_DNA_LABELS } from '@we/template-kit';

import type { Crumb } from './bar.ts';
import { DNA_FOCUS, showDna } from './paths.ts';
import { VOCABULARY_NAMES, WE_VOCABULARY } from './vocabulary.ts';

/**
 * The space's Social DNA, named once for the three places that draw it: the tree lists it, the Social
 * DNA page reads it as cards, and the canvas draws it as the vocabulary map. Each reads the same
 * lists, and the same focus from the address (`?dna=`).
 *
 * Social DNA is the classes the space has — its own models, other apps' classes and WE's — and its
 * policy. A class in focus is `model|<name>`, whoever wrote it, and one of its records
 * `model|<name>|<id>`; a rule of the policy is `policy|<words>`.
 */

/** The policy, which is rules in words rather than records: one a row, by its words. */
export const POLICY = { kind: 'policy', bucket: 'policy', label: SOCIAL_DNA_LABELS.policy, icon: 'scales' } as const;
export const POLICY_RULES = 'spaceStore.policy.sentences';

/** The kind of focus a class is, whoever wrote it. */
export const MODEL = 'model';

const quoted = (names: string[]) => `[${names.map((n) => `'${n}'`).join(', ')}]`;
const table = (entries: [string, string][]) => `{ ${entries.map(([k, v]) => `${k}: ${v}`).join(', ')} }`;

/*
  The three groups. Each class is `{ id, label, icon }` — `id` its name, which is also what `distinct`
  lists each by, so two apps' classes of one name are one row — and another app's carries its
  `namespace` as well, shown for the reader, not used to tell classes apart.
*/

const asClass = 'k, { id: k.value, label: k.label, icon: k.icon }';

/** The space's own models, as the record lists know them. */
export const SPACE_CLASSES = `recordStore.creatableEntities.filter(k, k.group == 'This space').map(${asClass})`;

/** WE's: its vocabulary, then its built-in blocks. */
export const WE_CLASSES = `distinct([${WE_VOCABULARY.map(
  (cls) => `{ id: '${cls.name}', label: '${cls.label}', icon: '${cls.icon}' }`,
).join(', ')}], recordStore.creatableEntities.filter(k, k.group != 'This space').map(${asClass}))`;

/**
 * Another app's classes, flat and by name, as the store publishes them: every class the space carries
 * that is not one of its own models or WE's, and not WE's plumbing — a `Space` an older version wrote
 * under another IRI is still WE's. Each name once, with the namespace (the class IRI before its name) of the first
 * that carries it, shown as secondary text. A name resolves to one class, so two apps' classes of one
 * name are one row, under whichever namespace comes first. Where a class comes from is not recorded
 * anywhere, so it is shown rather than grouped by.
 */
const OTHER_ENTITIES = 'datasetStore.currentDatasetEntities';
export const OTHER_CLASSES = [
  `distinct(${OTHER_ENTITIES}.filter(e, !(e.name in recordStore.creatableEntities.map(k, k.value)) && !(e.name in recordStore.plumbingClasses) && !(e.name in ${VOCABULARY_NAMES})).map(e, e.name))`,
  `.map(n, { id: n, label: recordStore.displays[n].label ?? n, icon: 'cube', namespace: first(split(find(${OTHER_ENTITIES}, { name: n }).targetClass, n)) ?? '' })`,
].join('');

/** The groups the classes are listed in — the space's own, other apps', WE's — those with any. */
export const CLASS_GROUPS = `[{ key: 'space', label: 'This space', classes: ${SPACE_CLASSES} }, { key: 'other', label: 'Other apps', classes: ${OTHER_CLASSES} }, { key: 'we', label: 'WE', classes: ${WE_CLASSES} }].filter(g, count(g.classes) > 0)`;
/** How many classes there are. */
export const CLASS_COUNT = `sum(${CLASS_GROUPS}.map(g, count(g.classes)))`;

/** The focus, as `all` where the address names none — the Social DNA page reached without one. */
export const DNA_AT = `(${DNA_FOCUS} ? ${DNA_FOCUS} : 'all')`;
/** The kind in focus (`model`, `policy`), what of it (a class's name, a rule's words), and a record of the class. */
export const DNA_KIND = `split(${DNA_AT}, '|')[0]`;
export const DNA_ID = `split(${DNA_AT}, '|')[1]`;
export const DNA_RECORD = `split(${DNA_AT}, '|')[2]`;

/** A class is in focus. */
export const ON_CLASS = `${DNA_KIND} == '${MODEL}' && ${DNA_ID}`;

/** The class in focus keeps its records in a store's list (see `WeVocabularyClass.list`). */
const LISTS = WE_VOCABULARY.filter((cls) => cls.list);
const LISTED = `${DNA_ID} in ${quoted(LISTS.map((cls) => cls.name))}`;

/** The records of a class not listed by a store, asked only while one is in focus. Declare it where the rows are read. */
export const CLASS_QUERIES = {
  classRows: {
    entity: { $: DNA_ID },
    order: { createdAt: 'desc' },
    limit: 100,
    when: { $: `(${ON_CLASS}) && !(${LISTED})` },
  },
};

/** The records of the class in focus: the store's list where it keeps one, else the query's. */
export const CLASS_ROWS = `(${LISTED} ? ${table(LISTS.map((cls) => [cls.name, cls.list!]))}[${DNA_ID}] : local.classRows)`;
/** Whether they have been read — a store's list is there already. */
export const CLASS_ROWS_LOADED = `${LISTED} || local.classRowsLoaded`;

/** How the class in focus is drawn — every class has a display, whoever wrote it. */
export const CLASS_DISPLAY = `recordStore.displays[${DNA_ID}]`;
/** What the class in focus is called: WE's vocabulary by the settings' words, any other as its display names it. */
export const CLASS_LABEL = `(${table(WE_VOCABULARY.map((cls) => [cls.name, `'${cls.label}'`]))}[${DNA_ID}] ?? ${CLASS_DISPLAY}.label) ?? ${DNA_ID}`;
/** Its glyph. */
export const CLASS_ICON = `(${table(WE_VOCABULARY.map((cls) => [cls.name, `'${cls.icon}'`]))}[${DNA_ID}] ?? ${CLASS_DISPLAY}.icon) ?? 'cube'`;

/**
 * The vocabulary map's bucket for what is in focus: the policy's, one of WE's vocabulary classes' own,
 * or — any other class being a model on the map — Models for the space's and WE's, From other apps
 * for the rest.
 */
export const BUCKET = `(${[
  `${DNA_KIND} == 'policy' ? 'policy'`,
  `: (${table(WE_VOCABULARY.map((cls) => [cls.name, `'${cls.bucket}'`]))}[${DNA_ID}] ?? (${DNA_ID} in recordStore.creatableEntities.map(k, k.value) ? 'models' : 'other'))`,
].join(' ')})`;
/** The focus is a model on the map — a node of its own, opening into its records — rather than a bucket. */
export const ON_MAP_MODEL = `(${ON_CLASS}) && (${BUCKET}) in ['models', 'other']`;

/**
 * A node of the vocabulary map, as the focus it stands for — so pressing it on the map moves the focus
 * there, as choosing its row in the tree does. `node` is an expression naming the graph's node. A
 * bucket of WE's vocabulary is its class, a definition in one a record of it, a model its class, a
 * rule its words; anything else (what a definition is used for, a workflow, the Models bucket) is
 * nothing, and leaves the focus where it was.
 */
export const dnaFocusOf = (node: string): string => {
  const cls = `${table(WE_VOCABULARY.map((c) => [c.bucket, `'${c.name}'`]))}[${node}.data.bucket]`;
  return [
    `${node}.data.bucket == 'policy' ? (${node}.type == 'vocabulary' ? 'policy' : 'policy|' + ${node}.data.item)`,
    `: ${node}.data.bucket in ['models', 'other'] ? (${node}.data.entity ? '${MODEL}|' + ${node}.data.entity : '')`,
    `: !(${cls}) ? ''`,
    `: ${node}.type == 'vocabulary' ? '${MODEL}|' + ${cls}`,
    `: ${node}.recordId ? '${MODEL}|' + ${cls} + '|' + ${node}.recordId : ''`,
  ].join(' ');
};

/** The record of the class in focus, by what its display says names it. */
const RECORD_NAME = `find(${CLASS_ROWS}, { id: ${DNA_RECORD} })[${CLASS_DISPLAY}.title ?? 'name']`;

/** The crumbs a Social DNA focus shows: Social DNA, then the class or the policy, then a record or a rule — each a way back up. */
export const dnaCrumbs = (when = 'true'): Crumb[] => [
  { label: 'Social DNA', onClick: showDna("'all'"), when },
  {
    label: { $: `${DNA_KIND} == 'policy' ? '${POLICY.label}' : ${CLASS_LABEL}` },
    onClick: showDna(`${DNA_KIND} == 'policy' ? 'policy' : '${MODEL}|' + ${DNA_ID}`),
    when: `(${when}) && ${DNA_AT} != 'all'`,
  },
  {
    label: { $: `${DNA_KIND} == 'policy' ? ${DNA_ID} : (${RECORD_NAME}) ?? 'Record'` },
    when: `(${when}) && (${DNA_KIND} == 'policy' ? ${DNA_ID} : ${DNA_RECORD})`,
  },
];

/** The class in focus as the community's Shape, where it is one of theirs — what its settings know it by. */
const MODEL_SHAPE = `shapeStore.spaceShapes.find(s, s.name == (${DNA_ID})).id`;

/**
 * Where the definitions are edited, from the bar of either view of them: the space's vocabulary
 * settings — at the model chosen, where it is one of the community's.
 */
export const editDna: SchemaNode = {
  type: 'we-button',
  props: {
    variant: 'ghost',
    size: 'sm',
    onClick: {
      $invoke: 'shellStore.openSpaceSettings',
      args: ['vocabulary', { $: `${DNA_KIND} == '${MODEL}' ? (${MODEL_SHAPE}) ?? '' : ''` }],
    },
  },
  children: [{ type: 'we-icon', props: { name: 'pencil-simple' } }, 'Edit in settings'],
};
