/**
 * What a new space can start with: the app's starters, when the app in use came in a bundle the seed
 * builds in and brings some, otherwise the deployment's — and an empty space either way. The first is
 * what a space gets unless somebody chooses otherwise in the create dialog. See `spaceStarter.ts` in `@we/schema-shared` for why the
 * app's come first.
 *
 * Only built-in bundles are asked, which is what keeps an installed bundle's starter out: an app
 * installed from a file is in the agent's library, never among the seed's bundles, so the lookup by
 * its bundle id finds nothing. Its starter would write into the space for everyone in it, and no
 * install asks about that yet.
 */
import type { SpaceStarter, TemplateSchema } from '@we/schema-shared';

import type { BundlePieces } from './bundlePieces';

export interface StarterFacts {
  /** The app in use — its `source` says which bundle it came in, if any. */
  app: Pick<TemplateSchema, 'source'> | undefined;
  /** The bundles the seed builds in. */
  builtIn: readonly Pick<BundlePieces, 'bundleId' | 'name' | 'brand' | 'starters'>[];
  /** The seed's own starters. */
  seed: readonly SpaceStarter[] | undefined;
}

/** The id of the choice that applies no starter. */
export const NO_STARTER = '$none';

/** One thing a new space can start with, as the create dialog offers it. */
export interface StarterChoice {
  id: string;
  name: string;
  description: string;
  icon: string;
  /** What it writes, counted from its records — "3 task states · 1 reaction · a canvas". */
  includes: string;
  /** Absent for the choice that applies none. */
  starter: SpaceStarter | undefined;
  /** The app it came with, by name — absent for the deployment's own and for none. */
  app?: string;
}

/**
 * Everything a new space can start with, the one it gets by default first: the app's starters when
 * the app in use came in a built-in bundle that brings some, otherwise the deployment's, then an
 * empty space.
 */
export function spaceStarterChoices(facts: StarterFacts): StarterChoice[] {
  const bundleId = facts.app?.source?.bundle;
  const bundle = bundleId ? facts.builtIn.find((pieces) => pieces.bundleId === bundleId) : undefined;
  const app = bundle && (bundle.brand?.name ?? bundle.name);
  const choice = (starter: SpaceStarter, from?: string): StarterChoice => ({
    id: starter.id,
    name: starter.name ?? starter.id,
    description: starter.description ?? '',
    icon: starter.icon ?? 'package',
    includes: starterIncludes(starter),
    starter,
    ...(from ? { app: from } : {}),
  });
  // An app's kit takes the deployment's place rather than sitting beside it: the deployment's is an
  // earlier take on the same records, and listed together they differed mostly in their look.
  const kits = bundle?.starters?.length
    ? bundle.starters.map((starter) => choice(starter, app))
    : (facts.seed ?? []).map((starter) => choice(starter));
  return [
    ...kits,
    {
      id: NO_STARTER,
      // Named by what is missing: what every space has anyway is not something anybody can see.
      name: 'Empty space',
      description: 'No task states, reactions, canvas or board. Set up your own in Social DNA.',
      icon: 'circle-dashed',
      includes: '',
      starter: undefined,
    },
  ];
}

/** What a record of each entity is called in an includes line, one and many. */
const RECORD_WORDS: Record<string, [string, string]> = {
  SignalType: ['reaction', 'reactions'],
  TaskState: ['task state', 'task states'],
  InvolvementType: ['way to be involved', 'ways to be involved'],
  Role: ['role', 'roles'],
};

/**
 * What a starter writes, as one line counted from its records — so the line cannot drift from what
 * a create press does. A record inside another of the starter's (a board's columns) is part of that
 * one and is not counted; a collection is named by its kind.
 */
export function starterIncludes(starter: SpaceStarter): string {
  const counts = new Map<string, number>();
  for (const record of starter.records ?? []) {
    if (record.in !== undefined && record.in !== '$root') continue;
    const kind = record.entity === 'CollectionBlock' ? record.fields?.kind : undefined;
    const key = typeof kind === 'string' && kind ? `kind:${kind}` : record.entity;
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts]
    .map(([key, n]) => {
      if (key.startsWith('kind:')) {
        const kind = key.slice(5);
        return n === 1 ? `a ${kind}` : `${n} ${kind}s`;
      }
      const [one, many] = RECORD_WORDS[key] ?? [key, `${key}s`];
      return `${n} ${n === 1 ? one : many}`;
    })
    .join(' · ');
}
