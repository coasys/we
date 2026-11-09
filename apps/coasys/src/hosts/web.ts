/**
 * The browser's base host: a browser keeps no identity and runs no backend, so the one thing it can
 * offer is AD4M Connect, which asks where the person's executor is (an address, a Coasys account) and
 * signs in there. The identity comes with that session; Devices and Security are Settings' once it
 * runs.
 */
import type { BackendConnector, BaseConnection, BaseHandOff, BaseHost } from '@we/app-shell/shared';
import { isUnreachable } from '@we/app-web/platform/deviceKeyConnector';
import { rememberedSessionBase } from '@we/app-web/platform/storedSession';

/** The browser's one place: AD4M Connect's own screen. */
export const CONNECT: BaseConnection = {
  id: 'connect',
  kind: 'connect',
  label: 'AD4M Connect',
  detail: 'Sign in to the executor that keeps your data: on your computer, a server, or a Coasys account',
};

/** How long the executor AD4M Connect signed in to last has to answer: AD4M Connect's own wait. */
export const REACH_MS = 10_000;

/** The executor AD4M Connect signed in to last did not answer, so its own connect screen is not due. */
export class ConnectUnreachable extends Error {
  constructor(
    readonly url: string,
    readonly cause: unknown,
  ) {
    super(
      `The executor it signed in to last (${hostOf(url)}) did not answer. Try again once it is running, or choose another place.`,
    );
    this.name = 'ConnectUnreachable';
  }
}

function hostOf(url: string): string {
  try {
    return new URL(url).host;
  } catch {
    return url;
  }
}

/** What {@link reachRemembered} asks with; the tests pass their own. */
export interface ReachDeps {
  /** The executor AD4M Connect holds a session on (its http base), or null with none. */
  remembered?: () => string | null;
  /** Resolves when something answers at `base`; rejects when nothing does. */
  reach?: (base: string) => Promise<void>;
  online?: () => boolean;
}

/**
 * Whether anything answers at `base`, by the address AD4M Connect checks (`/health`). An opaque
 * answer is still an answer: whether it is a working executor is AD4M Connect's to say, with its
 * own words; only "nothing answered" is the base app's.
 */
export async function answers(base: string, ms: number = REACH_MS): Promise<void> {
  await fetch(`${base}/health`, { mode: 'no-cors', cache: 'no-store', signal: AbortSignal.timeout(ms) });
}

/**
 * AD4M Connect's connector, asked first whether the executor it will go back to answers.
 *
 * AD4M Connect opens the executor it signed in to last, and when that one does not answer it draws
 * its own connect screen over the app, as though nothing had been chosen. A relaunch with that
 * executor switched off, or out of reach, is the base app's offline state instead: the reason and
 * "Try again". So the failure is thrown before AD4M Connect starts, and the base app, which hears an
 * unreachable place from the session's connector, takes the page back. With no session remembered
 * nothing has been chosen yet, and AD4M Connect's screen is the right one; and the person choosing
 * AD4M Connect from the list ({@link connectFor}) is asking for that screen, so it is not asked first.
 */
export function reachRemembered(connector: BackendConnector, deps: ReachDeps = {}): BackendConnector {
  const remembered = deps.remembered ?? rememberedSessionBase;
  const reach = deps.reach ?? answers;
  const online = deps.online ?? (() => globalThis.navigator?.onLine ?? true);
  return {
    ...connector,
    initialize: async (ctx) => {
      const base = remembered();
      if (base) {
        try {
          await reach(base);
        } catch (error) {
          if (isUnreachable(error, online())) throw new ConnectUnreachable(base, error);
          // Something answered, if not as an executor: AD4M Connect has words for that.
        }
      }
      return connector.initialize(ctx);
    },
  };
}

/** A place AD4M Connect or a key login could not reach, told from one that refused. */
export function unreachable(error: unknown, online: () => boolean): boolean {
  return error instanceof ConnectUnreachable || isUnreachable(error, online());
}

/**
 * AD4M Connect's connector for a hand-off: asked about the remembered executor first on a resume or
 * "Try again", and handed over as it is when the person chose it, so a retired executor still lets
 * them reach AD4M Connect's screen and give another address.
 */
export function connectFor(
  connector: BackendConnector,
  how: BaseHandOff | undefined,
  deps: ReachDeps,
): BackendConnector {
  return how?.chosen ? connector : reachRemembered(connector, deps);
}

export function webBaseHost(connector: BackendConnector, deps: ReachDeps = {}): BaseHost {
  const online = deps.online ?? (() => globalThis.navigator?.onLine ?? true);
  return {
    kind: 'browser',
    connections: async () => [CONNECT],
    connector: async (_connection, how) => connectFor(connector, how, { ...deps, online }),
    isUnreachable: (error) => unreachable(error, online),
    online,
  };
}
