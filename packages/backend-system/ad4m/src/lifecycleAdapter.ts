/**
 * AD4M implementations of the lifecycle half of the backend contract
 * (`DatasetLifecyclePort` + `AgentSessionPort`) — wrapping the exact `client.perspective.*`,
 * `client.neighbourhood.*`, and `client.agent.*` calls the app shell's stores previously made
 * directly. Datasets are perspectives; shared datasets are neighbourhoods.
 */
import { Ad4mClient, Perspective, type PerspectiveProxy, RpcError } from '@coasys/ad4m';
import {
  type AgentIdentity,
  type AgentSessionPort,
  type DatasetChangeHandlers,
  type DatasetLifecyclePort,
  type DatasetRef,
  type LinkLanguageTemplate,
  SessionTimeoutError,
} from '@we/backend-shared';

import { ensureFileStorageLanguage } from './agentHelpers';

const SCHEME = 'neighbourhood://';

/** Template parameters `publish` supplies (`description` is optional and left to its default). */
const FILLED_TEMPLATE_PARAMS = new Set(['uid', 'name', 'description']);

/**
 * How long past the client's own RPC timeout an unlock or generate is still waited for.
 *
 * That timeout (30s) abandons the reply, not the work. The executor carries on starting Holochain
 * and loading languages, then announces the result with an `agent-status-changed` event — so a
 * 408 on these two calls means "still going", and a cold start can legitimately outlast 30s.
 */
const SESSION_SETTLE_MS = 150_000;

function toRef(p: PerspectiveProxy): DatasetRef {
  return {
    id: p.uuid,
    name: p.name,
    ...(p.sharedUrl ? { sharedUri: p.sharedUrl, sharedId: p.sharedUrl.replace(SCHEME, '') } : {}),
    handle: p,
  };
}

export function createAd4mDatasetLifecycle(backendClient: unknown): DatasetLifecyclePort {
  const client = backendClient as Ad4mClient;

  /**
   * AD4M keeps its own bookkeeping in perspectives too: the agent's public profile perspective,
   * and the "Agent perspective …" ones the executor materialises for peers. They are not user
   * datasets, so they never leave this adapter — which datasets are an implementation detail of
   * the backend is the backend's question, not the shell's.
   */
  let ownProfileDatasetId: string | undefined;
  let ownProfileResolved = false;
  async function resolveOwnProfileDatasetId(): Promise<void> {
    if (ownProfileResolved) return;
    try {
      const me = await client.agent.me();
      ownProfileDatasetId = (me.perspective as { uuid?: string } | undefined)?.uuid;
      ownProfileResolved = true;
    } catch {
      // Identity not usable yet (locked agent) — retry next call rather than caching a miss.
    }
  }

  const isBackendBookkeeping = (p: PerspectiveProxy): boolean =>
    p.uuid === ownProfileDatasetId || !!p.name?.toLowerCase().startsWith('agent perspective');

  /**
   * The link language templates `publish` can actually instantiate, in the node's own order.
   *
   * `publish` fills a template with `uid` and `name` only. A template declaring any other
   * parameter — a server-backed one needs its server URL and room — would be published with
   * those left as placeholders and never sync, so it is left out rather than offered. A template
   * whose meta cannot be read is kept: nothing says it needs more.
   */
  async function publishableTemplates(): Promise<LinkLanguageTemplate[]> {
    const addresses = (await client.runtime.knownLinkLanguageTemplates()) ?? [];
    const templates = await Promise.all(
      addresses.map(async (address) => {
        try {
          const meta = await client.languages.meta(address);
          const params = meta.possibleTemplateParams ?? [];
          if (params.some((param) => !FILLED_TEMPLATE_PARAMS.has(param))) return null;
          return { address, name: meta.name || address };
        } catch {
          return { address, name: address };
        }
      }),
    );
    return templates.filter((t): t is LinkLanguageTemplate => t !== null);
  }

  return {
    async list() {
      await resolveOwnProfileDatasetId();
      return (await client.perspective.all()).filter((p) => !isBackendBookkeeping(p)).map(toRef);
    },

    async get(id) {
      const p = await client.perspective.byUUID(id);
      return p ? toRef(p) : null;
    },

    async create(name) {
      return toRef(await client.perspective.add(name));
    },

    async remove(id) {
      await client.perspective.remove(id);
    },

    /**
     * Publish a local dataset as a neighbourhood. The returned URL is captured by the caller —
     * the proxy's own `sharedUrl` is not updated in place.
     */
    async publish(id: string, linkLanguageTemplate?: string) {
      const p = await client.perspective.byUUID(id);
      if (!p) throw new Error(`publish: no dataset with id ${id}`);
      const uid = crypto.randomUUID();
      const templateAddress = linkLanguageTemplate || (await publishableTemplates())[0]?.address;
      if (!templateAddress) throw new Error('No link language templates available to publish neighbourhood.');
      const templateData = JSON.stringify({ uid, name: `${p.name}-link-language` });
      const linkLanguage = await client.languages.applyTemplateAndPublish(templateAddress, templateData);
      const uri = await client.neighbourhood.publishFromPerspective(id, linkLanguage.address, new Perspective([]));
      return { uri, sharedId: uri.replace(SCHEME, '') };
    },

    linkLanguageTemplates: publishableTemplates,

    async join(idOrUri) {
      // Accept a bare shared id: this backend's URIs carry the neighbourhood scheme.
      const uri = idOrUri.includes('://') ? idOrUri : SCHEME + idOrUri;
      const handle = await client.neighbourhood.joinFromUrl(uri);
      const joined = await client.perspective.byUUID(handle.uuid);
      if (!joined) throw new Error(`join: no dataset handle after joining ${uri}`);
      return toRef(joined);
    },

    async members(id) {
      return client.neighbourhood.otherAgents(id);
    },

    /**
     * AD4M's listener API has no detach; the returned unsubscribe guards the callbacks instead.
     * In practice the shell subscribes once for the app's lifetime.
     */
    subscribe(handlers: DatasetChangeHandlers) {
      let active = true;

      client.perspective.addPerspectiveAddedListener((handle) => {
        if (!active) return null;
        void (async () => {
          await resolveOwnProfileDatasetId();
          const p = await client.perspective.byUUID(handle.uuid);
          if (active && p && !isBackendBookkeeping(p)) handlers.onAdded?.(toRef(p));
        })();
        return null;
      });

      client.perspective.addPerspectiveUpdatedListener((handle) => {
        if (!active) return null;
        client.perspective.byUUID(handle.uuid).then((p) => {
          if (active && p) handlers.onUpdated?.(toRef(p));
        });
        return null;
      });

      client.perspective.addPerspectiveRemovedListener((uuid) => {
        if (active) handlers.onRemoved?.(uuid);
        return null;
      });

      return () => {
        active = false;
      };
    },
  };
}

export function createAd4mAgentSession(backendClient: unknown): AgentSessionPort {
  const client = backendClient as Ad4mClient;

  /**
   * The file-storage language is installed lazily, on the first unlocked session — see
   * `ensureFileStorageLanguage`. Best-effort: a failure here (no peers yet, network still
   * settling) must not block login, and the next unlocked session retries, so the flag is only
   * latched on success.
   */
  let fileStorageReady = false;

  /*
    Calls waiting out a timed-out generate/unlock. One listener for the port's lifetime rather than
    one per call, because AD4M's listener API has no detach.

    The event is the signal, not `agent.status()`: status reports unlocked the moment the wallet
    opens, before Holochain and the languages are up, and the executor only publishes this event at
    the end of the handler. Polling status would carry on into a session that is not ready.
  */
  const settleWaiters = new Set<() => void>();
  client.agent.addAgentStatusChangedListener((status) => {
    if (!(status as { isUnlocked?: unknown } | undefined)?.isUnlocked) return;
    for (const settle of [...settleWaiters]) settle();
  });

  /**
   * Run a generate/unlock, and wait for the executor to finish it when the reply times out.
   *
   * The waiter is registered before the call: the event lands whenever the executor finishes, which
   * can be after the reply was abandoned but before this code would otherwise be listening. A refusal
   * (wrong password, an agent that already exists) is rethrown as it came.
   */
  async function settleSessionCall(call: () => Promise<unknown>): Promise<void> {
    let settle!: () => void;
    const settled = new Promise<void>((resolve) => (settle = resolve));
    settleWaiters.add(settle);
    try {
      await call();
    } catch (err) {
      if (!(err instanceof RpcError && err.status === 408)) throw err;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const expired = new Promise<'expired'>((resolve) => {
        timer = setTimeout(() => resolve('expired'), SESSION_SETTLE_MS);
      });
      const outcome = await Promise.race([settled.then(() => 'settled' as const), expired]);
      clearTimeout(timer);
      if (outcome === 'expired') throw new SessionTimeoutError(err.message);
    } finally {
      settleWaiters.delete(settle);
    }
  }

  async function ensureFileStorage(): Promise<void> {
    if (fileStorageReady) return;
    try {
      await ensureFileStorageLanguage(client);
      fileStorageReady = true;
    } catch (error) {
      console.warn('AD4M: could not install the file-storage language', error);
    }
  }

  return {
    async status() {
      const status = await client.agent.status();
      // Covers the boot path where the executor was left running and the agent is already
      // unlocked — neither generate() nor unlock() is called in that case.
      if (status.isUnlocked) void ensureFileStorage();
      return { hasAgent: !!status.did, unlocked: !!status.isUnlocked };
    },

    /**
     * `agent.generate` returns an already-unlocked status, so there is no unlock step after it —
     * the executor holds the freshly derived keys in memory. Holochain is started as part of the
     * same call, matching what `unlock(password, true)` does on the returning-agent path.
     */
    async generate(password) {
      await settleSessionCall(() => client.agent.generate(password));
      await ensureFileStorage();
    },

    async unlock(password) {
      await settleSessionCall(() => client.agent.unlock(password, true));
      await ensureFileStorage();
    },

    async lock(password) {
      await client.agent.lock(password);
    },

    /**
     * The raw agent spread under a neutral `id` — `did` stays present because it IS the id in
     * this backend, and template-facing vocabulary (`$me.did`) reads it.
     */
    async me() {
      const agent = await client.agent.me();
      return { ...(agent as unknown as Record<string, unknown>), id: agent.did } as AgentIdentity;
    },
  };
}
