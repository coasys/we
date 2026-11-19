import type { SchemaNode } from '@we/schema-shared';
import { OTHER_APP_CLASS_NAMES, SOCIAL_DNA_LABELS } from '@we/template-kit';

import type { Crumb } from './bar.ts';
import { DNA_AT, showDna } from './paths.ts';
import { VOCABULARY_NAMES, WE_VOCABULARY } from './vocabulary.ts';

/**
 * The space's Social DNA, named once for the three places that draw it: the tree lists it, the Social
 * DNA page reads it as cards, and the canvas draws it as the vocabulary map. Each reads the same
 * lists, and the same focus from the address (`?dna=`).
 *
 * Social DNA is the classes the space has — its models (its own and other apps') and WE's — and its
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

/** WE's vocabulary classes, in the settings' order and words. */
const VOCABULARY_CLASSES = `[${WE_VOCABULARY.map(
  (cls) => `{ id: '${cls.name}', label: '${cls.label}', icon: '${cls.icon}' }`,
).join(', ')}]`;

/**
 * WE's built-in blocks. Every built-in class `creatableEntities` lists is a block, since only a block
 * has a way to be made (`creationPath`), so no list of block names is kept here. A vocabulary class
 * is left out all the same: it is listed as a row of its own, and the rule that keeps one out of
 * `creatableEntities` lives in another package, where a change would otherwise list it twice.
 */
const BLOCK_CLASSES = `recordStore.creatableEntities.filter(k, k.group != 'This space' && !(k.value in ${VOCABULARY_NAMES})).map(${asClass})`;

/** WE's: its vocabulary, then its built-in blocks. */
export const WE_CLASSES = `distinct(${VOCABULARY_CLASSES}, ${BLOCK_CLASSES})`;

/**
 * Another app's classes, flat and by name, as the store publishes them: every class the space carries
 * that is not one of its own models or WE's, and not WE's plumbing — a `Space` an older version wrote
 * under another IRI is still WE's. Each name once, with the namespace (the class IRI before its name) of the first
 * that carries it, shown as secondary text. A name resolves to one class, so two apps' classes of one
 * name are one row, under whichever namespace comes first. Where a class comes from is not recorded
 * anywhere, so it is shown rather than grouped by. The names are the vocabulary map's own (`OTHER_APP_CLASS_NAMES`).
 */
const OTHER_ENTITIES = 'datasetStore.currentDatasetEntities';
export const OTHER_CLASSES = [
  OTHER_APP_CLASS_NAMES,
  `.map(n, { id: n, label: recordStore.displays[n].label ?? n, icon: 'cube', namespace: first(split(find(${OTHER_ENTITIES}, { name: n }).targetClass, n)) ?? '' })`,
].join('');

/**
 * The groups the classes are listed in — Models, then the built-in ones. Each group is
 * `{ key, label, classes, rows, sub }`:
 *
 * - `classes` is every class in the group, nested ones included: what a count, a "this class is in
 *   here" test and the page's sections read.
 * - `rows` is the classes listed directly in the group, and `sub` its nested groups, each
 *   `{ key, label, classes }`, listed after the rows.
 *
 * Models is the space's own models and then other apps' classes, one list: who wrote a class is said
 * by its namespace, quietly, not by a group of its own. A name the space and another app both carry
 * is one row, the space's. Models is listed even with nothing in it, since it is one of the three
 * things Social DNA holds; the built-in group is listed when it has anything.
 *
 * Only the built-in group nests: its vocabulary classes are its rows, and the blocks sit together
 * in one "Blocks" group at the end. They are different kinds of thing, a community's own definitions
 * and the kinds of content, and every block listed among the vocabulary classes buried them.
 */
export const MODEL_CLASSES = `distinct(${SPACE_CLASSES}, ${OTHER_CLASSES})`;
const MODELS_GROUP = `{ key: 'models', label: 'Models', classes: ${MODEL_CLASSES}, rows: ${MODEL_CLASSES}, sub: [] }`;
const BUILT_IN = `{ key: 'we', label: 'Built in', classes: ${WE_CLASSES}, rows: ${VOCABULARY_CLASSES}, sub: [{ key: 'blocks', label: 'Blocks', classes: ${BLOCK_CLASSES} }].filter(s, count(s.classes) > 0) }`;
export const CLASS_GROUPS = `[${MODELS_GROUP}, ${BUILT_IN}].filter(g, g.key == 'models' || count(g.classes) > 0)`;
/** One of those groups by its key, as a list of it or of nothing — for the places that draw them apart. */
export const classGroup = (key: 'models' | 'we'): string => `${CLASS_GROUPS}.filter(g, g.key == '${key}')`;
/** The flows a record can go through: written, not put away — Social DNA's Flows. */
export const FLOW_DEFINITIONS = 'workflowStore.workflows.filter(f, !f.archived)';

/**
 * The flows running: how many records are still going through the space's flows — not at a final
 * step — as the store counts them, live, for each. Counted rather than listed, since the store keeps
 * no list of runs across flows; the flows page lists them a flow at a time.
 */
export const RUNNING_FLOWS = `sum(${FLOW_DEFINITIONS}.map(f, f.running))`;

/** How many classes there are. */
export const CLASS_COUNT = `sum(${CLASS_GROUPS}.map(g, count(g.classes)))`;

export { DNA_AT };
/** The kind in focus (`model`, `policy`), what of it (a class's name, a rule's words), and a record of the class. */
export const DNA_KIND = `split(${DNA_AT}, '|')[0]`;
export const DNA_ID = `split(${DNA_AT}, '|')[1]`;
export const DNA_RECORD = `split(${DNA_AT}, '|')[2]`;

/**
 * An expression over the focus's parts — kind, what of it, record — written once over a single reading
 * of the address, for the expressions that would otherwise repeat the whole of `DNA_AT` in each.
 */
export const onFocus = (body: (kind: string, id: string, record: string) => string): string =>
  `[split(${DNA_AT}, '|')].map(p, ${body('p[0]', 'p[1]', 'p[2]')})[0]`;

/** A class is in focus. */
export const ON_CLASS = `${DNA_KIND} == '${MODEL}' && ${DNA_ID}`;

/** The class in focus keeps its records in a store's list (see `WeVocabularyClass.list`). */
const LISTS = WE_VOCABULARY.filter((cls) => cls.list);
const listedOf = (id: string) => `${id} in ${quoted(LISTS.map((cls) => cls.name))}`;
const LISTED = listedOf(DNA_ID);

/** The class in focus is one of WE's vocabulary, whose records are read whole and by name. */
const NAMED = WE_VOCABULARY.filter((cls) => !cls.list);
const namedOf = (id: string) => `${id} in ${quoted(NAMED.map((cls) => cls.name))}`;
const ON_NAMED = namedOf(DNA_ID);
/** How many rows the read of any other class holds at most. */
const PAGE = 100;

/**
 * The records of a class not listed by a store, asked only while one is in focus. Declare it where the
 * rows are read. WE's own vocabulary is read whole, by name, as the vocabulary settings list it; any
 * other class by what is newest, a page of it.
 */
export const CLASS_QUERIES = {
  vocabRows: {
    entity: { $: DNA_ID },
    order: { name: 'asc' },
    when: { $: `(${ON_CLASS}) && (${ON_NAMED})` },
  },
  classRows: {
    entity: { $: DNA_ID },
    order: { createdAt: 'desc' },
    limit: PAGE,
    when: { $: `(${ON_CLASS}) && !(${LISTED}) && !(${ON_NAMED})` },
  },
  // The record chosen, where it is beyond the page — so its crumb still names it.
  classRecord: {
    entity: { $: DNA_ID },
    where: { id: { $: DNA_RECORD } },
    limit: 1,
    when: { $: `(${ON_CLASS}) && ${DNA_RECORD} && !(${LISTED})` },
  },
};

/** The records of the class `id`: the store's list where it keeps one, else the query's. */
const rowsOf = (id: string) =>
  `(${listedOf(id)} ? ${table(LISTS.map((cls) => [cls.name, cls.list!]))}[${id}] : ${namedOf(id)} ? local.vocabRows : local.classRows)`;
/** The records of the class in focus. */
export const CLASS_ROWS = onFocus((_kind, id) => rowsOf(id));
/** Whether they have been read — a store's list is there already. */
export const CLASS_ROWS_LOADED = `${LISTED} || (${ON_NAMED} ? local.vocabRowsLoaded : local.classRowsLoaded)`;
/** How many there are, as the heading says it: `100+` where the read stops at a page and that page is full. */
export const CLASS_ROWS_COUNT = onFocus(
  (_kind, id) =>
    `(!(${listedOf(id)}) && !(${namedOf(id)}) && count(${rowsOf(id)}) >= ${PAGE} ? '${PAGE}+' : count(${rowsOf(id)}))`,
);

/** How the class in focus is drawn — every class has a display, whoever wrote it. */
export const CLASS_DISPLAY = `recordStore.displays[${DNA_ID}]`;
/** What the class in focus is called: WE's vocabulary by the settings' words, any other as its display names it. */
export const CLASS_LABEL = `(${table(WE_VOCABULARY.map((cls) => [cls.name, `'${cls.label}'`]))}[${DNA_ID}] ?? ${CLASS_DISPLAY}.label) ?? ${DNA_ID}`;
/** Its glyph. */
export const CLASS_ICON = `(${table(WE_VOCABULARY.map((cls) => [cls.name, `'${cls.icon}'`]))}[${DNA_ID}] ?? ${CLASS_DISPLAY}.icon) ?? 'cube'`;

/**
 * The vocabulary map's bucket for the focus `kind`, `id`: the policy's, one of WE's vocabulary classes'
 * own, or — any other class being a model on the map — Models for the space's and WE's, From other
 * apps for the rest.
 */
export const bucketOf = (kind: string, id: string): string =>
  `(${kind} == 'policy' ? 'policy' : (${table(WE_VOCABULARY.map((cls) => [cls.name, `'${cls.bucket}'`]))}[${id}] ?? (${id} in recordStore.creatableEntities.map(k, k.value) ? 'models' : 'other')))`;
/** The focus is a model on the map — a node of its own, opening into its records — rather than a bucket. */
export const onMapModel = (kind: string, id: string): string =>
  `(${kind} == '${MODEL}' && ${id} && ${bucketOf(kind, id)} in ['models', 'other'])`;

/** The bucket of the focus in the address. */
export const BUCKET = onFocus((kind, id) => bucketOf(kind, id));
/** The focus in the address is a model on the map. */
export const ON_MAP_MODEL = onFocus((kind, id) => onMapModel(kind, id));

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

/** The crumbs a Social DNA focus shows: Social DNA, then the class or the policy, then a record or a rule — each a way back up. */
export const dnaCrumbs = (when = 'true'): Crumb[] => [
  { label: 'Social DNA', onClick: showDna("'all'"), when },
  {
    label: { $: `${DNA_KIND} == 'policy' ? '${POLICY.label}' : ${CLASS_LABEL}` },
    onClick: showDna(`${DNA_KIND} == 'policy' ? 'policy' : '${MODEL}|' + ${DNA_ID}`),
    when: `(${when}) && ${DNA_AT} != 'all'`,
  },
  {
    // A record is named by what its class's display says names it: from the rows, else the one asked for
    // by itself — the rows are a page, and the record may be beyond it.
    label: {
      $: onFocus(
        (kind, id, record) =>
          `${kind} == 'policy' ? ${id} : ((find(${rowsOf(id)}, { id: ${record} }) ?? first(local.classRecord))[recordStore.displays[${id}].title ?? 'name']) ?? 'Record'`,
      ),
    },
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
