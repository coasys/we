/**
 * Where a Coasys space's things live, named once.
 *
 * A space is one tree and one view: the tree says what is selected, the view draws it. Both read the
 * same few expressions, so they are written here rather than twice.
 */

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
export const channelPath = (idExpr: string): string => `spaceStore.spacePath + '?channel=' + (${idExpr})`;

/** A call's address: its record's own page, drawn by the call view. */
export const callPath = (idExpr: string): string =>
  `spaceStore.spacePath + '/record/CollectionBlock?kind=call&id=' + (${idExpr})`;

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
export const groupPath = (page: GroupPage): string => `spaceStore.spacePath + '/${page}'`;

/**
 * The tree row that matches the address, as `we-tree`'s `selected` takes it: `<kind>|<id>`. Each row
 * reports its value in the same form, so choosing one and arriving at it by link light the same row.
 * A group's page lights the group's row — every group with a page, not only Workflows.
 */
export const SELECTED_EXPR = [
  `(${PAGE_EXPR}) == 'record' ? 'call|' + routeStore.params.id`,
  `: (${PAGE_EXPR}) == 'workflows' ? (workflowStore.open ? 'workflow|' + workflowStore.open.name : 'group|workflows')`,
  `: (${PAGE_EXPR}) in [${GROUP_PAGES.filter((p) => p !== 'workflows')
    .map((p) => `'${p}'`)
    .join(', ')}] ? 'group|' + (${PAGE_EXPR})`,
  `: 'channel|' + (${CHANNEL_EXPR})`,
].join(' ');

/** The id part of a tree row's value. */
export const ROW_ID = "split(event.detail.value, '|')[1]";
