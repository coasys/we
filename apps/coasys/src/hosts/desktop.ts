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
  BaseAgentPasswordAnswer,
  BaseAgentState,
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
  /** Sends the agent its WE password, where no keyring could be used; answers how it went. */
  password?(password: string): Promise<unknown>;
  /** The tray's "Executor settings…": open Settings where the executor's are. Hands back its unsubscribe. */
  onOpenSettings?(listener: () => void): () => void;
}

const AGENT_STATES: readonly BaseAgentState[] = ['unlocked', 'locked', 'needs-password', 'needs-new-password'];
const PASSWORD_ANSWERS: readonly BaseAgentPasswordAnswer[] = ['unlocked', 'wrong', 'refused', 'failed'];

/**
 * What the shell says about its executor, as a state; anything else is a failure with no reason. Up,
 * how its agent is, where the shell says (Electron's supervisor, which makes it: `mainAgent.js`).
 */
function asState(value: unknown): BaseExecutorState {
  const v = value as { phase?: unknown; reason?: unknown; agent?: unknown; stopped?: unknown } | null;
  if (v?.phase === 'starting') return { phase: 'starting' };
  if (v?.phase === 'ready') {
    const agent = AGENT_STATES.find((known) => known === v.agent);
    return agent ? { phase: 'ready', agent } : { phase: 'ready' };
  }
  if (v?.phase === 'failed') {
    const reason = typeof v.reason === 'string' ? v.reason : '';
    // Stopped after it ran, rather than failing to start: the base takes the window back for it.
    return v.stopped === true ? { phase: 'failed', reason, stopped: true } : { phase: 'failed', reason };
  }
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
    /*
      The shell reads its agent again to answer (Electron's `executor-state`, `main.js`), and tells
      every listener of a change as well. An answer the shell has said something since is dropped;
      a shell that cannot answer leaves the state as it was, since this is a second look.
    */
    async refresh() {
      const asked = heard;
      let answer: unknown;
      try {
        answer = await bridge.state();
      } catch {
        return;
      }
      if (heard === asked) set(asState(answer));
    },
    /*
      The WE password, where the shell asked for it (Electron's `executor-agent-password`). The shell
      tells every listener the agent is unlocked as well; the answer is only how it went.
    */
    ...(bridge.password
      ? {
          async givePassword(password: string): Promise<BaseAgentPasswordAnswer> {
            let answer: unknown;
            try {
              answer = await bridge.password!(password);
            } catch (error) {
              throw new Error(shellRefusal(error));
            }
            return PASSWORD_ANSWERS.find((known) => known === answer) ?? 'failed';
          },
        }
      : {}),
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

export const WORDS_EXECUTOR_NOT_UP =
  "This computer's executor is not up yet. Your identity can be changed here once it is.";

/*
  A locked agent with nothing kept for it is one made with a WE password, or one whose kept passphrase
  this computer lost (its keyring item deleted, the keyring reset): the app cannot tell the two apart,
  so the words say what to do for each.
*/
/** Where no keyring could be used, the base app asks for the WE password before anything else. */
export const WORDS_AGENT_NEEDS_PASSWORD =
  "This computer's agent waits for your WE password. Give it first, then your identity can be changed here.";

export const WORDS_AGENT_LOCKED =
  "This computer's agent is locked, so your identity cannot be changed here yet. Choose This computer and sign in with your WE password. If you never set one, the key this computer kept for your agent is gone: restore your identity with your 12 words.";

/**
 * The custody service as the base app's identity source. With the shell's `executor`, the doors open
 * only once it is ready with its agent unlocked: every step runs against the executor's main agent,
 * which Electron's supervisor makes and unlocks at each start (`mainAgent.js`, a stopgap until AR-06's
 * `storage.unlock`). An agent with nothing kept for it stays locked until sign-in, and the base app
 * asks the executor again (`refresh`) when it is shown and before a door opens. An executor that does
 * not say how its agent is leaves the doors as they were.
 */
export function custodyIdentitySource(custody: Ad4mCustodyHost, executor?: BaseExecutor): BaseIdentitySource {
  const open = {
    make: { step: { kind: 'create' } },
    link: { step: { kind: 'show-code' } },
    words: custody.takesWords === false ? { step: null, note: WORDS_HERE_OFF } : { step: { kind: 'restore' } },
  } satisfies BaseIdentitySource['doors'];
  const closed = (note: string): BaseIdentitySource['doors'] => ({
    make: { step: null, note },
    link: { step: null, note },
    words: { step: null, note },
  });
  return {
    state: async () => {
      try {
        return readCustody(await custody.publicState());
      } catch (error) {
        throw new Error(shellRefusal(error));
      }
    },
    get doors() {
      const now = executor?.state();
      if (!now) return open;
      if (now.phase !== 'ready') return closed(WORDS_EXECUTOR_NOT_UP);
      if (now.agent === 'locked') return closed(WORDS_AGENT_LOCKED);
      if (now.agent === 'needs-password' || now.agent === 'needs-new-password')
        return closed(WORDS_AGENT_NEEDS_PASSWORD);
      return open;
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
    ...(options.custody ? { identity: custodyIdentitySource(options.custody, options.executor) } : {}),
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
