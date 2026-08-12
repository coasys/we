/**
 * Sample content for the showcase templates.
 *
 * See `types.ts` for the format and why it is data rather than a script per template.
 */
export { applyFixture, datasetIdFor, pathFor } from './apply.ts';
export type { AppliedFixture, ApplyDeps } from './apply.ts';
export { editorState, editorStateNode, textContent } from './editorState.ts';
export type { Fixture, FixtureAgent, FixtureNode, FixturePresence, FixtureSignalType } from './types.ts';

import { discordFixture } from './discord.ts';
import { eventsFixture, instagramFixture, kanbanFixture, twitterFixture, youtubeFixture } from './rest.ts';

export { discordFixture, eventsFixture, instagramFixture, kanbanFixture, twitterFixture, youtubeFixture };
export { PLATES, WIDE } from './images.ts';

/** Every fixture, by id — what the shoot script resolves a `--fixture` argument against. */
export const FIXTURES = {
  discord: discordFixture,
  twitter: twitterFixture,
  instagram: instagramFixture,
  youtube: youtubeFixture,
  kanban: kanbanFixture,
  events: eventsFixture,
} as const;

export type FixtureId = keyof typeof FIXTURES;
