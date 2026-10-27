/**
 * Which starter a new space gets: the app's, when the app in use came in a bundle the seed builds in
 * and that bundle brings one, and otherwise the deployment's. See `spaceStarter.ts` in
 * `@we/schema-shared` for why the app wins.
 *
 * Only built-in bundles are asked, which is what keeps an installed bundle's starter from applying:
 * an app installed from a file is in the agent's library, never among the seed's bundles, so the
 * lookup by its bundle id finds nothing and the seed's starter applies.
 */
import { defaultSpaceStarter, type SpaceStarter, type TemplateSchema } from '@we/schema-shared';

import type { BundlePieces } from './bundlePieces';

export interface NewSpaceStarter {
  starter: SpaceStarter | undefined;
  /** The app the starter came with, by name — absent when it is the deployment's own. */
  app?: string;
}

export function newSpaceStarter(facts: {
  /** The app in use — its `source` says which bundle it came in, if any. */
  app: Pick<TemplateSchema, 'source'> | undefined;
  /** The bundles the seed builds in. */
  builtIn: readonly Pick<BundlePieces, 'bundleId' | 'name' | 'brand' | 'starters'>[];
  /** The seed's own starters. */
  seed: readonly SpaceStarter[] | undefined;
}): NewSpaceStarter {
  const bundleId = facts.app?.source?.bundle;
  const bundle = bundleId ? facts.builtIn.find((pieces) => pieces.bundleId === bundleId) : undefined;
  const own = bundle && defaultSpaceStarter(bundle.starters);
  if (bundle && own) return { starter: own, app: bundle.brand?.name ?? bundle.name };
  return { starter: defaultSpaceStarter(facts.seed) };
}
