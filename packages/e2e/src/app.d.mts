import type { Host, SeedLike } from '@we/csp';

/** The seed this process would build: `WE_SEED`, or `we-seed.json`. */
export function currentSeed(): SeedLike;

/** The production policy a host serves for a seed, as a header. */
export function productionCsp(options?: { host?: Host; seed?: SeedLike }): string;

export interface ServedApp {
  /** `http://127.0.0.1:<port>`. */
  url: string;
  /** The Content-Security-Policy header every response carries. */
  policy: string;
  close(): Promise<void>;
}

/** Serves a built app's directory with the production policy as a header. */
export function serveDist(dir: string, options?: { seed?: SeedLike; host?: Host }): Promise<ServedApp>;
