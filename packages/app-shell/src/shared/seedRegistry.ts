import type { WeSeedFile } from '../types/seed';

/**
 * The deployment seed, held once the host supplies it.
 *
 * The shell used to import `we-seed.json` from the repo root — three files reaching four to six
 * directories *outside their own package* for deployment configuration. That inverted the whole
 * arrangement: the seed describes a deployment, deployments are what apps are, and the apps are the
 * composition root that already hands the shell its platform and backend. So the seed arrives the
 * same way, through `PlatformProvider`, and everything in the shell reads it from here.
 *
 * A module singleton rather than a context because non-component code (`queryIRFlag`, store
 * factories) reads it, and because there is exactly one seed per running app by definition.
 */
let seed: WeSeedFile | null = null;

export function provideSeed(next: WeSeedFile): void {
  seed = next;
}

export function getSeed(): WeSeedFile {
  if (!seed) {
    throw new Error('seed not provided — pass the deployment seed to PlatformProvider before mounting the shell');
  }
  return seed;
}
