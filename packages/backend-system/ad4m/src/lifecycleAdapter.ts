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

/** Template parameters a template may declare and still publish without a value. */
const OPTIONAL_TEMPLATE_PARAMS = ['description'];

/** What a template that declares no parameters has always been given. */
const pick = ({ uid, name }: Record<string, string>) => ({ uid, name });

export interface Ad4mLifecycleOptions {
  /**
   * The link server a shared space can sync through, from the deployment's seed
   * (`ad4m.linkServerUrl`). Without one, the server link language is never offered: it has
   * nowhere to connect to.
   */
  linkServerUrl?: string;
  /**
   * Development only: where this machine's build of the server link language bundle is, or null.
   *
   * Until the bootstrap seed ships the server link language (coasys/ad4m#1037), a node does not
   * know the template, so there is nothing to offer however the deployment is configured. Given a
   * bundle and a `linkServerUrl`, the adapter publishes it and adds it to the node's known
   * templates the first time templates are listed — after sign-in, since publishing a language
   * needs an unlocked agent. Skipped when the node already knows a server template.
   */
  devLinkLanguageBundle?: () => Promise<string | null>;
}

/** The meta the server link language is published with — its declared parameters are what matter. */
const SERVER_LINK_LANGUAGE_META = {
  name: 'server-link-language',
  description: 'AD4M link language that syncs through a self-hosted link-server',
  sourceCodeLink: 'https://github.com/coasys/ad4m/tree/dev/bootstrap-languages/server-link-language',
  possibleTemplateParams: ['SERVER_URL', 'ROOM_ID', 'name', 'description'],
};

/**
 * How long past the client's own RPC timeout an unlock or generate is still waited for.
 *
 * That timeout (30s) abandons the reply, not the work. The executor carries on starting Holochain
 * and loading languages, then announces the result with an `agent-status-changed` event — so a
 * 408 on these two calls means "still going", and a cold start can legitimately outlast 30s.
 */
const SESSION_SETTLE_MS = 150_000;

/** What a perspective's handle says about it — the same whether it arrives as a proxy or an event. */
type PerspectiveFacts = Pick<PerspectiveProxy, 'name'> &
  Partial<Pick<PerspectiveProxy, 'state' | 'sharedUrl' | 'neighbourhood' | 'owners'>>;

function toRef(p: PerspectiveProxy): DatasetRef {
  return {
    id: p.uuid,
    name: p.name,
    ...(p.sharedUrl ? { sharedUri: p.sharedUrl, sharedId: p.sharedUrl.replace(SCHEME, '') } : {}),
    handle: p,
  };
}

export function createAd4mDatasetLifecycle(
  backendClient: unknown,
  options: Ad4mLifecycleOptions = {},
): DatasetLifecyclePort {
  const client = backendClient as Ad4mClient;

  /*
    One proxy per perspective, for the life of the connection.

    Every \`PerspectiveProxy\` the SDK builds registers four subscriptions on the shared socket (link
    added, removed and updated, and sync state) in its constructor, and nothing a caller holds can
    release them without also releasing every other proxy's for the same perspective:
    \`dispose()\` clears per uuid, and the sync-state one sits in a list nothing removes from. So a
    proxy built to read a name and dropped was never dropped. \`list()\` built one per perspective
    on every call, \`get()\` one per switch, and every \`perspective-updated\` event one more — each
    firing on every message the socket carries, for the rest of the session.

    Holding the first proxy and refreshing its facts from later reads keeps one set of listeners
    per perspective, and lets a read the registry can already answer skip the round trip.
  */
  const proxies = new Map<string, PerspectiveProxy>();

  /** The facts a ref reads, from a later read or event, onto the proxy already held. */
  function refresh(held: PerspectiveProxy, fresh: PerspectiveFacts): void {
    held.name = fresh.name;
    if (fresh.state !== undefined) held.state = fresh.state;
    if (fresh.sharedUrl) held.sharedUrl = fresh.sharedUrl;
    if (fresh.neighbourhood) held.neighbourhood = fresh.neighbourhood;
    if (fresh.owners) held.owners = fresh.owners;
  }

  function adopt(p: PerspectiveProxy): PerspectiveProxy {
    const held = proxies.get(p.uuid);
    if (!held) {
      proxies.set(p.uuid, p);
      return p;
    }
    refresh(held, p);
    return held;
  }

  /*
    Keeping the registry true, so it can answer \`list()\` itself.

    From the first subscription on, the adapter hears every perspective added, updated and removed,
    and applies each to the registry before anyone else hears of it. The registry is then complete
    after one full read made while listening — nothing can have changed unheard since — and \`list()\`
    stops reading at all. A read made before listening began cannot be trusted that way: a
    perspective could have arrived between the read and the first event.
  */
  let tracking = false;
  let complete = false;
  const subscribers = new Set<DatasetChangeHandlers>();

  function track(): void {
    if (tracking) return;
    tracking = true;

    client.perspective.addPerspectiveAddedListener((handle) => {
      void (async () => {
        await resolveOwnProfileDatasetId();
        const held = proxies.get(handle.uuid);
        if (held) refresh(held, handle);
        const p = held ?? (await proxyFor(handle.uuid));
        if (!p || isBackendBookkeeping(p)) return;
        for (const s of subscribers) s.onAdded?.(toRef(p));
      })();
      return null;
    });

    client.perspective.addPerspectiveUpdatedListener((handle) => {
      // The event carries the whole handle, so a perspective already held needs no read at all.
      const held = proxies.get(handle.uuid);
      if (held) {
        refresh(held, handle);
        for (const s of subscribers) s.onUpdated?.(toRef(held));
        return null;
      }
      void proxyFor(handle.uuid).then((p) => {
        if (p) for (const s of subscribers) s.onUpdated?.(toRef(p));
      });
      return null;
    });

    client.perspective.addPerspectiveRemovedListener((uuid) => {
      proxies.delete(uuid);
      for (const s of subscribers) s.onRemoved?.(uuid);
      return null;
    });
  }

  /** The held proxy for this uuid, or a fresh read of it adopted as the one to hold. */
  async function proxyFor(uuid: string): Promise<PerspectiveProxy | null> {
    const held = proxies.get(uuid);
    if (held) return held;
    const p = await client.perspective.byUUID(uuid);
    return p ? adopt(p) : null;
  }

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
   * The values `publish` can give a template's parameters, for one neighbourhood.
   *
   * `uid` and `ROOM_ID` are fresh each time, so every neighbourhood gets its own link language and,
   * on a link server, its own room — which the server creates when the first agent connects, so
   * there is nothing to provision. `SERVER_URL` exists only where the deployment named a server.
   * `description` is absent on purpose: templates declaring it treat it as optional.
   */
  function templateValues(datasetName: string): Record<string, string> {
    return {
      uid: crypto.randomUUID(),
      name: `${datasetName}-link-language`,
      ...(options.linkServerUrl ? { SERVER_URL: options.linkServerUrl, ROOM_ID: crypto.randomUUID() } : {}),
    };
  }

  /** Parameters a template declares that `publish` has no value for — empty when it can publish. */
  function unfillableParams(params: readonly string[]): string[] {
    const fillable = new Set([...Object.keys(templateValues('')), ...OPTIONAL_TEMPLATE_PARAMS]);
    return params.filter((param) => !fillable.has(param));
  }

  /**
   * A template's name and declared parameters. `params` is null when it declares none or its meta
   * cannot be read — it is then taken to want what every link language here has always been given.
   */
  async function templateMeta(address: string): Promise<{ name: string; params: string[] | null }> {
    try {
      const meta = await client.languages.meta(address);
      return { name: meta.name || address, params: meta.possibleTemplateParams ?? null };
    } catch {
      return { name: address, params: null };
    }
  }

  /** See `Ad4mLifecycleOptions.devLinkLanguageBundle`. Settles once; a failure is retried next list. */
  let devRegistration: Promise<void> | undefined;
  function registerDevServerTemplate(): Promise<void> {
    if (!options.devLinkLanguageBundle || !options.linkServerUrl) return Promise.resolve();
    devRegistration ??= (async () => {
      const bundle = await options.devLinkLanguageBundle?.();
      if (!bundle) return;
      const known = (await client.runtime.knownLinkLanguageTemplates()) ?? [];
      const metas = await Promise.all(known.map(templateMeta));
      if (metas.some((m) => m.params?.includes('SERVER_URL'))) return;
      const published = await client.languages.publish(bundle, SERVER_LINK_LANGUAGE_META);
      // The store keeps the first meta published under an address and hands it back for a repeat
      // publish of the same bytes. Registering a build whose stored meta names other parameters
      // would add a template the list then hides, with nothing said about why.
      if (!published.possibleTemplateParams?.includes('SERVER_URL')) {
        console.warn(
          `[lifecycle] not registering ${published.address}: the language store already holds that build with ` +
            `template parameters ${JSON.stringify(published.possibleTemplateParams)}, not SERVER_URL/ROOM_ID.`,
        );
        return;
      }
      await client.runtime.addKnownLinkLanguageTemplates([published.address]);
      console.info(`[lifecycle] registered the local server link language build as ${published.address}`);
    })().catch((error) => {
      devRegistration = undefined;
      console.warn('[lifecycle] could not register the local server link language build:', error);
    });
    return devRegistration;
  }

  /**
   * The link language templates `publish` can actually instantiate, peer-to-peer ones first.
   *
   * A template declaring a parameter `publish` cannot fill is left out rather than offered: it
   * would be published with that parameter still a placeholder and never sync. That is what hides
   * the server link language on a deployment that has not named a link server.
   *
   * The first entry is the default, and the node's own order says nothing: AD4M sorts known
   * templates by address, which is a hash. So templates syncing through a server go last. Sending a
   * community's links to a server should be something somebody chose, not what a hash decided.
   */
  async function publishableTemplates(): Promise<LinkLanguageTemplate[]> {
    await registerDevServerTemplate();
    const addresses = (await client.runtime.knownLinkLanguageTemplates()) ?? [];
    const templates = await Promise.all(
      addresses.map(async (address) => {
        const { name, params } = await templateMeta(address);
        if (params && unfillableParams(params).length) return null;
        return params?.includes('SERVER_URL')
          ? { address, name, kind: 'server' as const, serverUrl: options.linkServerUrl }
          : { address, name, kind: 'peer-to-peer' as const };
      }),
    );
    return templates
      .filter((t) => t !== null)
      .sort((a, b) => Number(a.kind === 'server') - Number(b.kind === 'server'));
  }

  return {
    async list() {
      // Once the registry is known complete, it is the answer: `all()` builds a handle for every
      // perspective, and each one's subscriptions stay behind however quickly it is dropped.
      // The own-profile lookup the filter needs runs beside the read, not before it: on a boot it
      // was a round trip of its own ahead of everything else.
      if (!complete) {
        const tracked = tracking;
        const [, all] = await Promise.all([resolveOwnProfileDatasetId(), client.perspective.all()]);
        for (const p of all) adopt(p);
        complete = tracked;
      } else {
        await resolveOwnProfileDatasetId();
      }
      return [...proxies.values()].filter((p) => !isBackendBookkeeping(p)).map(toRef);
    },

    async get(id) {
      const p = await proxyFor(id);
      return p ? toRef(p) : null;
    },

    async create(name) {
      return toRef(adopt(await client.perspective.add(name)));
    },

    async remove(id) {
      await client.perspective.remove(id);
      proxies.delete(id);
    },

    /**
     * Publish a local dataset as a neighbourhood. The returned URL is captured by the caller —
     * the proxy's own `sharedUrl` is not updated in place.
     */
    async publish(id: string, linkLanguageTemplate?: string) {
      const p = await proxyFor(id);
      if (!p) throw new Error(`publish: no dataset with id ${id}`);
      const templateAddress = linkLanguageTemplate || (await publishableTemplates())[0]?.address;
      if (!templateAddress) throw new Error('No link language templates available to publish neighbourhood.');
      const { params } = await templateMeta(templateAddress);
      const missing = params ? unfillableParams(params) : [];
      if (missing.length) {
        throw new Error(`publish: the chosen link language needs ${missing.join(', ')}, which is not configured.`);
      }
      // Only what the template declares, so a Holochain template is never handed a server URL.
      const values = templateValues(p.name);
      const templateData = JSON.stringify(
        params ? Object.fromEntries(params.filter((k) => k in values).map((k) => [k, values[k]])) : pick(values),
      );
      const linkLanguage = await client.languages.applyTemplateAndPublish(templateAddress, templateData);
      const uri = await client.neighbourhood.publishFromPerspective(id, linkLanguage.address, new Perspective([]));
      // The held proxy outlives this call, so it carries the answer too — a later `get` reads it.
      p.sharedUrl = uri;
      return { uri, sharedId: uri.replace(SCHEME, '') };
    },

    linkLanguageTemplates: publishableTemplates,

    async join(idOrUri) {
      // Accept a bare shared id: this backend's URIs carry the neighbourhood scheme.
      const uri = idOrUri.includes('://') ? idOrUri : SCHEME + idOrUri;
      const handle = await client.neighbourhood.joinFromUrl(uri);
      const held = proxies.get(handle.uuid);
      if (held) refresh(held, handle);
      const joined = held ?? (await proxyFor(handle.uuid));
      if (!joined) throw new Error(`join: no dataset handle after joining ${uri}`);
      return toRef(joined);
    },

    async members(id) {
      return client.neighbourhood.otherAgents(id);
    },

    /**
     * AD4M's listener API has no detach, so the adapter registers its three listeners once, for
     * the life of the connection, and hands each event to whoever is subscribed at the time.
     */
    subscribe(handlers: DatasetChangeHandlers) {
      track();
      subscribers.add(handlers);
      return () => {
        subscribers.delete(handlers);
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
