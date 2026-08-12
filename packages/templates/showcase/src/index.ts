/**
 * Six applications over one universal container.
 *
 * Every template here is data — a JSON node tree — and every container in them is a
 * `CollectionBlock` with a `kind` label this package invented and a `mode` saying who owns its
 * children. **No new content model was added for any of them.** That is the claim the package
 * exists to make: channels, boards, playlists and events are arrangement, not schema, so a template
 * dropped onto a space that has been collecting posts for a year works retroactively — nothing to
 * install, nothing to migrate.
 *
 * Three of them — Timeline, Photos, Videos — deliberately read *the same records*. Switching
 * between them turns a feed into a photo grid into a video library over one space, which is
 * data/interface separation demonstrated rather than asserted.
 *
 * What they are honest about, rather than faking:
 * - **No private channels.** A neighbourhood is writable by every member, so a collection is not a
 *   permission boundary. The channels template says so where a lock icon would lie.
 * - **No video uploads.** `VideoBlock` is url + provider; large media needs streamed storage.
 * - **No cross-space feed.** "Home" is this space's posts, because queries do not fan out yet.
 * - **No manual ordering.** Everything sorts by creation until the CRDT ordering work lands.
 *
 * See `notes/we/August-2026/collection-kinds-plan.md`.
 */
export { discordTemplate } from './DiscordTemplate.schema.ts';
export { eventsTemplate } from './EventsTemplate.schema.ts';
export { instagramTemplate } from './InstagramTemplate.schema.ts';
export { kanbanTemplate } from './KanbanTemplate.schema.ts';
export { twitterTemplate } from './TwitterTemplate.schema.ts';
export { youtubeTemplate } from './YoutubeTemplate.schema.ts';
export { KIND, MODE } from './shared.ts';
