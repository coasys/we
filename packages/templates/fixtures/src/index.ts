/**
 * Sample content for the showcase templates.
 *
 * See `types.ts` for the format and why it is data rather than a script per template.
 */
export { applyFixture, datasetIdFor, pathFor } from './apply.ts';
export type { AppliedFixture, ApplyDeps } from './apply.ts';
export { editorState, editorStateNode, textContent } from './editorState.ts';
export type {
  Fixture,
  FixtureAgent,
  FixtureNode,
  FixturePresence,
  FixtureSignalType,
} from './types.ts';

import { discordFixture } from './discord.ts';

export { discordFixture };

/** Every fixture, by id — what the shoot script resolves a `--fixture` argument against. */
export const FIXTURES = {
  discord: discordFixture,
} as const;

export type FixtureId = keyof typeof FIXTURES;
