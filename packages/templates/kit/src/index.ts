/**
 * The shapes WE's templates are built from, as data — the WE-domain tier, plus everything portable.
 *
 * ## Two packages, one import
 *
 * The kit has always had two tiers. The portable one names no store and now lives in
 * `@we/schema-kit`, where a feature module can reach it: the kit sitting under `templates/` made
 * `modules → templates` the only way to use a shape it already had, and that is the sideways edge
 * the dependency rules forbid — so the call module copied `peopleTooltip` by hand instead.
 *
 * What stays here reads WE's own stores (`profileStore`, `runtimeStore`, `datasetStore`) or its
 * schema machinery (`$agent`). That is the tier whose real dependency is the host's store surface,
 * which no `package.json` can express — a fragment naming `spaceStore.members` resolves to nothing
 * on a deployment without that store, silently. Keeping the two apart is how a consumer can tell
 * which fragments will work for them, and it is now a package boundary rather than a directory one.
 *
 * Everything portable is re-exported here, so a template importing `@we/template-kit` sees exactly
 * what it saw before and needs no change. A *module* should import `@we/schema-kit` directly — the
 * narrower dependency is the point, and it is the one that carries no store assumptions.
 *
 * ## What belongs in a fragment at all
 *
 * Code should own only what data *cannot express*: behaviour, focus management, accessibility
 * semantics, browser APIs, measurement. Everything above that line is arrangement, and arrangement
 * stays in a fragment — because a prop is a customisation somebody predicted, while a node tree is
 * every customisation, including the ones nobody thought of.
 *
 * The package README states this rule in full; CONVENTIONS.md carries the authoring rules
 * (extraction threshold, options-object API, the const rule) for both packages; and
 * `docs/architecture/template-fragments.md` is where all of it is going.
 */

// The portable tier, passed straight through. See `@we/schema-kit` for why it is a package.
export * from '@we/schema-kit';

// Collections — the container-shaped surfaces. All of these read `CollectionBlock.kind` and filter
// muted authors through `spaceStore.mutedDids`, which is what keeps them on this side of the line
// despite being ordinary list arrangements otherwise.
export { channelRail } from './lists/channelRail.ts';
export type { ChannelRailOptions } from './lists/channelRail.ts';
export { collectionFeed } from './lists/collectionFeed.ts';
export type { CollectionFeedOptions } from './lists/collectionFeed.ts';
export { commentThread, noReplies, replyCount } from './lists/commentThread.ts';
export type { CommentThreadOptions } from './lists/commentThread.ts';
export { mediaGrid } from './lists/mediaGrid.ts';
export type { MediaGridOptions } from './lists/mediaGrid.ts';

// WE-domain — these name WE's stores or its agent machinery.
export { adminSection } from './we/adminSection.ts';
export type { AdminSectionOptions } from './we/adminSection.ts';
export { agentByline } from './we/agentByline.ts';
export type { AgentBylineOptions } from './we/agentByline.ts';
export { installedList } from './we/installedList.ts';
export type { InstalledListOptions } from './we/installedList.ts';
export { RECORD_ROUTE_PATH, recordLink } from './we/recordLink.ts';
export { marketplaceList } from './we/marketplaceList.ts';
export type { MarketplaceListOptions } from './we/marketplaceList.ts';
export { peopleRow } from './we/peopleRow.ts';
export type { PeopleRowOptions } from './we/peopleRow.ts';
export { recordFormModal } from './we/recordForm.ts';
export type { RecordFormModalOptions } from './we/recordForm.ts';
