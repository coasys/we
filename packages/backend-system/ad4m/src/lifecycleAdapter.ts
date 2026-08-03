/**
 * AD4M implementations of the lifecycle half of the backend contract
 * (`DatasetLifecyclePort` + `AgentSessionPort`) — wrapping the exact `client.perspective.*`,
 * `client.neighbourhood.*`, and `client.agent.*` calls the app shell's stores previously made
 * directly. Datasets are perspectives; shared datasets are neighbourhoods.
 */
import { Ad4mClient, Perspective, type PerspectiveProxy } from '@coasys/ad4m';
import type {
  AgentIdentity,
  AgentSessionPort,
  DatasetChangeHandlers,
  DatasetLifecyclePort,
  DatasetRef,
} from '@we/backend-shared';

const SCHEME = 'neighbourhood://';

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
  return {
    async list() {
      return (await client.perspective.all()).map(toRef);
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
    async publish(id) {
      const p = await client.perspective.byUUID(id);
      if (!p) throw new Error(`publish: no dataset with id ${id}`);
      const uid = crypto.randomUUID();
      const languages = await client.runtime.knownLinkLanguageTemplates();
      const templateAddress = languages?.[0];
      if (!templateAddress) throw new Error('No link language templates available to publish neighbourhood.');
      const templateData = JSON.stringify({ uid, name: `${p.name}-link-language` });
      const linkLanguage = await client.languages.applyTemplateAndPublish(templateAddress, templateData);
      const uri = await client.neighbourhood.publishFromPerspective(id, linkLanguage.address, new Perspective([]));
      return { uri, sharedId: uri.replace(SCHEME, '') };
    },

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
        client.perspective.byUUID(handle.uuid).then((p) => {
          if (active && p) handlers.onAdded?.(toRef(p));
        });
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
  return {
    async status() {
      const status = await client.agent.status();
      return { hasAgent: !!status.did, unlocked: !!status.isUnlocked };
    },

    async unlock(password) {
      await client.agent.unlock(password, true);
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
