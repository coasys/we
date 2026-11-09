/**
 * The desktop's base host: this computer's custody service keeps the identity, this computer runs its
 * own executor, and a session is had from that executor. The servers the account was given are listed
 * too, but a session on one is not wired yet (coasys/we#428): choosing one refuses.
 *
 * Shared by both desktop shells, each passing what it has: Electron its preload bridge
 * (`window.electron.custody`, `executor`, `servers`), Tauri its `identity_*` commands. The doors are
 * the custody service's own steps — make the identity (`create`), show this computer's code for a
 * device of the identity to add (`show-code`), bring it back from the 12 words (`restore`) — each run
 * in the shell's identity window, which is the only place a secret is shown or typed. A shell with no
 * custody service (Electron on Windows) keeps no identity here, and the base app asks none of it.
 */
import type {
  BackendConnector,
  BaseConnection,
  BaseExecutor,
  BaseExecutorState,
  BaseHost,
  BaseIdentitySource,
} from '@we/app-shell/shared';
import { type Ad4mCustodyHost, readCustody } from '@we/backend-ad4m';

/**
 * The servers the signed-in account was given, and the one it is served by (`null`: this computer),
 * as the desktop shell keeps them. Bookkeeping only: they are listed as places, but a session on one
 * is not wired yet (coasys/we#428), so choosing one refuses and only `choose(null)` is ever recorded.
 */
export interface DesktopServers {
  list(): Promise<{ servers: { address: string; name: string }[]; serving: string | null }>;
  choose(address: string | null): Promise<void>;
}

export interface DesktopHostOptions {
  /** The custody service; absent where the shell runs none. */
  custody?: Ad4mCustodyHost;
  /** This computer's executor, as the shell reports it; absent where it does not say. */
  executor?: BaseExecutor;
  /** The connector to this computer's executor. */
  local: BackendConnector;
  servers?: DesktopServers;
}

/** How a desktop shell reports its executor: asked, heard, and tried again, all asynchronously. */
export interface ExecutorBridge {
  state(): Promise<BaseExecutorState>;
  onState(listener: (state: BaseExecutorState) => void): () => void;
  start(): Promise<unknown>;
}

/** What the shell says about its executor, as a state; anything else is a failure with no reason. */
function asState(value: unknown): BaseExecutorState {
  const v = value as { phase?: unknown; reason?: unknown } | null;
  if (v?.phase === 'starting' || v?.phase === 'ready') return { phase: v.phase };
  if (v?.phase === 'failed') return { phase: 'failed', reason: typeof v.reason === 'string' ? v.reason : '' };
  return { phase: 'failed', reason: 'The app did not say how its executor is.' };
}

/**
 * The shell's executor as the base app reads it, which is at once: "starting" until the shell's first
 * answer, then whatever the shell last said. A change heard before that answer is newer than it, so
 * the answer is dropped then.
 */
export function bridgedExecutor(bridge: ExecutorBridge): BaseExecutor {
  let current: BaseExecutorState = { phase: 'starting' };
  // How many changes the shell has sent: an answer is stale if one arrived after it was asked for.
  let heard = 0;
  const listeners = new Set<(state: BaseExecutorState) => void>();
  const set = (next: BaseExecutorState) => {
    current = next;
    for (const listener of listeners) listener(next);
  };
  const failed = (error: unknown): BaseExecutorState => ({
    phase: 'failed',
    reason: shellRefusal(error),
  });
  bridge.onState((next) => {
    heard += 1;
    set(asState(next));
  });
  void bridge.state().then(
    (answer) => {
      if (heard === 0) set(asState(answer));
    },
    (error: unknown) => {
      if (heard === 0) set(failed(error));
    },
  );
  return {
    state: () => current,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async start() {
      const asked = heard;
      set({ phase: 'starting' });
      let answer: BaseExecutorState;
      try {
        answer = asState(await bridge.start());
      } catch (error) {
        answer = failed(error);
      }
      if (heard === asked) set(answer);
    },
  };
}

export const WORDS_HERE_OFF =
  'This computer takes no 12 words. Bring your identity back on a computer that does, then link this one to it.';

/**
 * What the shell refused, as a sentence: Electron wraps every refusal of a call to its main process in
 * `Error invoking remote method '<channel>': Error: …`, which names the channel and not the reason.
 */
export function shellRefusal(error: unknown): string {
  const text = error instanceof Error ? error.message : String(error);
  return text.replace(/^Error invoking remote method '[^']*': (?:Error: )?/, '');
}

/** The custody service as the base app's identity source. */
export function custodyIdentitySource(custody: Ad4mCustodyHost): BaseIdentitySource {
  return {
    state: async () => {
      try {
        return readCustody(await custody.publicState());
      } catch (error) {
        throw new Error(shellRefusal(error));
      }
    },
    doors: {
      make: { step: { kind: 'create' } },
      link: { step: { kind: 'show-code' } },
      words: custody.takesWords === false ? { step: null, note: WORDS_HERE_OFF } : { step: { kind: 'restore' } },
    },
    open: async (step) => {
      // A computer joins by showing its code, never by a phone's offer page.
      if (step.kind === 'join') return 'failed';
      return custody.open(step);
    },
  };
}

export const THIS_COMPUTER_CONNECTION: BaseConnection = {
  id: 'this-device',
  kind: 'this-device',
  label: 'This computer',
  detail: 'The executor this app runs, with your data kept here',
};

const SERVER_PREFIX = 'server:';

/** The answers a client gives for no answer at all: a socket that failed, a call that timed out. */
const NO_ANSWER = [0, 408, 502, 503, 504];

/** Whether a server failed for want of a network rather than by its answer. */
export function serverUnreachable(error: unknown): boolean {
  const status = (error as { status?: unknown } | null)?.status;
  if (typeof status === 'number' && NO_ANSWER.includes(status)) return true;
  const message = error instanceof Error ? `${error.name}: ${error.message}` : typeof error === 'string' ? error : '';
  return /failed to fetch|networkerror|network request failed|err_internet_disconnected|err_name_not_resolved|err_connection|econnrefused|enotfound|etimedout|socket (?:hang up|closed)|websocket (?:closed|error)|connection (?:closed|refused|reset|lost)|timed? ?out/i.test(
    message,
  );
}

/**
 * A server chosen on the desktop, which cannot be opened from it yet: the remote session comes with
 * coasys/we#428. A refusal rather than a place out of reach, so the base app says it as it is and
 * does not wait for a network that would not change it.
 */
export class ServerNotConnectable extends Error {
  constructor(readonly server: string) {
    super(`${server} cannot be opened from this app yet: only this computer can. Choose This computer.`);
    this.name = 'ServerNotConnectable';
  }
}

export function desktopBaseHost(options: DesktopHostOptions): BaseHost {
  const servers = options.servers;
  return {
    kind: 'computer',
    ...(options.custody ? { identity: custodyIdentitySource(options.custody) } : {}),
    ...(options.executor ? { executor: options.executor } : {}),
    connections: async () => {
      const listed = servers ? (await servers.list()).servers : [];
      return [
        THIS_COMPUTER_CONNECTION,
        ...listed.map((s): BaseConnection => ({
          id: `${SERVER_PREFIX}${s.address}`,
          kind: 'server',
          label: s.name || s.address,
          detail: s.address,
        })),
      ];
    },
    connector: async (connection) => {
      /*
        The local connector reaches `localhost` with this computer's own admin credential, whatever was
        chosen: handed over for a server it would carry that credential under the server's name. A
        server has no connector of its own yet (coasys/we#428), so the choice refuses, and the shell's
        record of who serves the account is left as it was.
      */
      if (connection.kind !== 'this-device') throw new ServerNotConnectable(connection.label);
      if (servers) await servers.choose(null);
      return options.local;
    },
    isUnreachable: serverUnreachable,
    online: () => globalThis.navigator?.onLine ?? true,
  };
}
