import type { SchemaProp } from '@we/schema-shared';
import { openRecord } from '@we/template-kit';

import { VOCABULARY_NAMES } from './vocabulary.ts';

/**
 * Where a Coasys space's things live, named once.
 *
 * A space is one tree and one view: the tree says what is selected, the view draws it. Both read the
 * same few expressions, so they are written here rather than twice.
 */

/**
 * Page or Canvas: how whatever the tree has chosen is seen.
 *
 * In the address (`?view=canvas`), so a link to somebody's work on the canvas opens on the canvas. Every
 * navigation the space makes carries it (`withView`), which is what makes it sticky: in Canvas, choosing
 * one thing after another in the tree shows each on the canvas rather than leaving it.
 */
export const VIEW_PARAM = 'view';
export const IN_CANVAS = `routeStore.params.${VIEW_PARAM} == 'canvas'`;

/** A path with the mode carried on it, whichever way its query begins. */
export const withView = (pathExpr: string): string =>
  `(${pathExpr}) + ((${IN_CANVAS}) ? (contains(${pathExpr}, '?') ? '&' : '?') + '${VIEW_PARAM}=canvas' : '')`;

/**
 * The Social DNA in focus — `all`, a class (`model|<name>`), one of its records (`model|<name>|<id>`),
 * the policy (`policy`) or one rule of it (`policy|<rule>`) — drawn as the vocabulary map: over the canvas in Canvas mode, as its own
 * page (`/dna`) in Page mode. A definition is read in the inspector as well, which follows `card`.
 */
export const DNA_PARAM = 'dna';
export const DNA_FOCUS = `routeStore.params.${DNA_PARAM}`;

/**
 * What an address from before a class was a model meant: its kind, as the class it named. A bookmark
 * keeps working — `signal|like` is `model|SignalType|like` — and `class|X` is `model|X`.
 */
const LEGACY_CLASSES: [string, string][] = [
  ['signal', 'SignalType'],
  ['connection', 'RelationshipType'],
  ['relationship', 'RelationshipType'],
  ['taskstate', 'TaskState'],
  ['involvement', 'InvolvementType'],
  ['topic', 'Topic'],
];
const LEGACY_AT = `{ ${LEGACY_CLASSES.map(([k, v]) => `${k}: '${v}'`).join(', ')} }`;

/**
 * The focus as the rest of Social DNA reads it: `all` where the address names none or one nobody knows,
 * the focus as written where it is `all`, `policy` or `model|…`, and an old kind as the class it was.
 * Written over one binding of the address's parts, since it stands inside every expression that reads
 * the focus.
 */
export const DNA_AT = `(${DNA_FOCUS} ? [split(${DNA_FOCUS}, '|')].map(p, p[0] in ['all', 'policy', 'model'] ? ${DNA_FOCUS} : [p[0] == 'class' ? p[1] : ${LEGACY_AT}[p[0]]].map(c, c ? 'model|' + c + (p[p[0] == 'class' ? 2 : 1] ? '|' + p[p[0] == 'class' ? 2 : 1] : '') : 'all')[0])[0] : 'all')`;

/** The vocabulary map is being shown, in either mode. */
export const ON_DNA_PAGE = "(routeStore.templateSegments[0] ? routeStore.templateSegments[0] : '') == 'dna'";
export const DNA_SHOWN = `((${IN_CANVAS}) || ${ON_DNA_PAGE}) && ${DNA_FOCUS}`;

/**
 * Show a focus of Social DNA: on the canvas in Canvas mode, which stays where it is; on the Social DNA
 * page otherwise, as every other group row opens its page. `focus` is an expression.
 */
export const showDna = (focus: string): SchemaProp => ({
  $if: {
    condition: { $: IN_CANVAS },
    then: { $invoke: 'routeStore.setParam', args: [DNA_PARAM, { $: focus }] },
    else: dnaPage(focus),
  },
});

/** The Social DNA page, with `focus` in the address — and nothing else, so it is in Page mode. */
export const dnaPage = (focus: string): SchemaProp => ({
  $invoke: 'routeStore.navigate',
  args: [{ $: "spaceStore.spacePath + '/dna'" }, { $: `{ query: { ${DNA_PARAM}: ${focus} } }` }],
});

/** The inspector's panel id, as the space declares it — see `shell.ts`. */
export const INSPECTOR_PANEL = 'inspector';

/**
 * Open a record in the inspector beside the view: name it in the address, which is what the inspector
 * reads, and open the inspector's panel, which starts closed.
 */
export const inspect = (id: string, type: SchemaProp): SchemaProp[] => [
  ...openRecord(id, type),
  { $invoke: 'shellStore.openTemplatePanel', args: [INSPECTOR_PANEL] },
];

/** A definition read in the inspector beside a page lights its class's row. */
const INSPECTED_DNA = `routeStore.params.cardType in ${VOCABULARY_NAMES}`;

/** The channel on screen: the one the address names, or the space's own collection, its root channel. */
export const CHANNEL_EXPR = 'routeStore.params.channel ? routeStore.params.channel : spaceStore.root';
export const CHANNEL = { $: CHANNEL_EXPR };

/** Whether the channel on screen is the space's root — "General", which every space has. */
export const IN_ROOT_EXPR = `(${CHANNEL_EXPR}) == spaceStore.root`;

/**
 * Whether `IN_ROOT_EXPR` can be answered yet: the space's root has been read.
 *
 * A channel's address names it (`?channel=<id>`), General's included, and `root` is '' until it has
 * been read. So for that moment General's own address compared unequal to `root`, and the view drew
 * General as a sub-channel — mounting the sub-channel chat, sending its reads — then tore it down and
 * drew the Feed when `root` arrived. Choose between them only once this is true.
 */
export const ROOT_KNOWN_EXPR = 'spaceStore.rootLoaded';

/**
 * A channel's address, General's included: always `?channel=<id>`.
 *
 * Not the bare space path for General, though that also shows it: navigating to a bare path brings
 * back the query string last used there, so "the space with no channel named" came back as the last
 * channel opened and General could not be reached once another had been.
 */
export const channelPath = (idExpr: string): string => withView(`spaceStore.spacePath + '?channel=' + (${idExpr})`);

/** A call's address: its record's own page, drawn by the call view. */
export const callPath = (idExpr: string): string =>
  withView(`spaceStore.spacePath + '/record/CollectionBlock?kind=call&id=' + (${idExpr})`);

/** A person's address: their profile, drawn as the view. */
export const personPath = (didExpr: string): string => withView(`spaceStore.spacePath + '/person?did=' + (${didExpr})`);

/** Which part of the page the address is on — '' for a channel's chat. */
export const PAGE_EXPR = "routeStore.templateSegments[0] ? routeStore.templateSegments[0] : ''";

/**
 * The groups of the tree that are pages as well: pressing the row opens the page, a full view of what
 * the group lists. The key is both the group's row (`group|<key>`) and the page's address segment.
 * Workflows is the one page that was already there.
 */
export const GROUP_PAGES = ['channels', 'calls', 'workflows', 'people'] as const;
export type GroupPage = (typeof GROUP_PAGES)[number];

/** A group's page. */
export const groupPath = (page: GroupPage): string => withView(`spaceStore.spacePath + '/${page}'`);

/**
 * The tree row that matches the address, as `we-tree`'s `selected` takes it: `<kind>|<id>`. Each row
 * reports its value in the same form, so choosing one and arriving at it by link light the same row.
 * A group's page lights the group's row — every group with a page, not only Workflows.
 */
export const SELECTED_EXPR = [
  // Social DNA in focus, on the canvas or its page.
  // A class lights its row, with one of its records chosen as well.
  `${DNA_SHOWN} ? (${DNA_AT} == 'all' ? 'group|dna' : startsWith(${DNA_AT}, 'policy|') ? 'dnaprop|' + ${DNA_AT} : startsWith(${DNA_AT}, 'model|') ? 'dna|model|' + split(${DNA_AT}, '|')[1] : 'dnakind|' + ${DNA_AT})`,
  `:`,
  `routeStore.params.card && ${INSPECTED_DNA} ? 'dna|model|' + routeStore.params.cardType`,
  `: (${PAGE_EXPR}) == 'record' ? 'call|' + routeStore.params.id`,
  `: (${PAGE_EXPR}) == 'person' ? 'person|' + routeStore.params.did`,
  /*
    A record chosen on the flows page lights its row under Active flows. One that has finished has no
    row there, so nothing is lit: asking whether it is still running would take this expression past
    the length an expression may be.
  */
  `: (${PAGE_EXPR}) == 'workflows' ? (workflowStore.open ? (routeStore.params.card ? 'run|' + workflowStore.open.name + '|' + routeStore.params.card : 'workflow|' + workflowStore.open.name) : 'group|workflows')`,
  `: (${PAGE_EXPR}) in [${GROUP_PAGES.filter((p) => p !== 'workflows')
    .map((p) => `'${p}'`)
    .join(', ')}] ? 'group|' + (${PAGE_EXPR})`,
  `: 'channel|' + (${CHANNEL_EXPR})`,
].join(' ');

/** The id part of a tree row's value. */
export const ROW_ID = "split(event.detail.value, '|')[1]";
