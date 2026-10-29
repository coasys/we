import type { SchemaProp } from '@we/schema-shared';
import { openRecord } from '@we/template-kit';

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
 * The Social DNA in focus — `all`, a kind (`signal`), a definition (`signal|<id>`) or a rule of the
 * policy (`policy|<rule>`) — drawn as the vocabulary map: over the canvas in Canvas mode, as its own
 * page (`/dna`) in Page mode. A definition is read in the inspector as well, which follows `card`.
 */
export const DNA_PARAM = 'dna';
export const DNA_FOCUS = `routeStore.params.${DNA_PARAM}`;

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

/** The record type of each kind of definition the tree lists (a model is a Shape, which it opens elsewhere). */
const DNA_ENTITIES: Record<string, string> = {
  signal: 'SignalType',
  connection: 'RelationshipType',
  state: 'TaskState',
  involvement: 'InvolvementType',
  topic: 'Topic',
};
const table = (entries: [string, string][]) => `{ ${entries.map(([k, v]) => `${k}: '${v}'`).join(', ')} }`;
/** A kind of definition's record type, as an expression over an expression naming the kind. */
export const dnaEntityOf = (kind: string): string => `${table(Object.entries(DNA_ENTITIES))}[${kind}]`;
/** The kind of definition a record type is, or nothing. */
export const dnaKindOf = (entity: string): string =>
  `${table(Object.entries(DNA_ENTITIES).map(([k, v]) => [v, k]))}[${entity}]`;

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

/** A definition in the inspector, as its tree row — so a definition read beside a page is lit. */
const INSPECTED_DNA = dnaKindOf('routeStore.params.cardType');

/** The channel on screen: the one the address names, or the space's own collection, its root channel. */
export const CHANNEL_EXPR = 'routeStore.params.channel ? routeStore.params.channel : spaceStore.root';
export const CHANNEL = { $: CHANNEL_EXPR };

/** Whether the channel on screen is the space's root — "General", which every space has. */
export const IN_ROOT_EXPR = `(${CHANNEL_EXPR}) == spaceStore.root`;

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
  `${DNA_SHOWN} ? (${DNA_FOCUS} == 'all' ? 'group|dna' : contains(${DNA_FOCUS}, '|') ? (startsWith(${DNA_FOCUS}, 'policy|') ? 'dnaprop|' : 'dna|') + ${DNA_FOCUS} : 'dnakind|' + ${DNA_FOCUS})`,
  `:`,
  `routeStore.params.card && ${INSPECTED_DNA} ? 'dna|' + ${INSPECTED_DNA} + '|' + routeStore.params.card`,
  `: (${PAGE_EXPR}) == 'record' ? 'call|' + routeStore.params.id`,
  `: (${PAGE_EXPR}) == 'person' ? 'person|' + routeStore.params.did`,
  `: (${PAGE_EXPR}) == 'workflows' ? (workflowStore.open ? 'workflow|' + workflowStore.open.name : 'group|workflows')`,
  `: (${PAGE_EXPR}) in [${GROUP_PAGES.filter((p) => p !== 'workflows')
    .map((p) => `'${p}'`)
    .join(', ')}] ? 'group|' + (${PAGE_EXPR})`,
  `: 'channel|' + (${CHANNEL_EXPR})`,
].join(' ');

/** The id part of a tree row's value. */
export const ROW_ID = "split(event.detail.value, '|')[1]";
