/**
 * The AD4M implementation of {@link RuntimeAdminPort} — the settings the ADAM launcher owns.
 *
 * Every method here is a thin wrapper over `client.runtime.*` or `client.agent.*`. That thinness
 * is the point: the launcher's equivalent screens are React components with the same calls buried
 * inside them, which is why none of it was reachable from a host that bundles the executor instead
 * of shelling out to the launcher. Reaching the same GraphQL from the shell needs no new
 * privileges — only a place to put it.
 *
 * Not covered, and not by oversight: multi-agent switching, log levels, data paths, MCP and proxy
 * configuration. Those are Tauri commands in the launcher because they manipulate the host's
 * filesystem and process, and no amount of GraphQL reaches them — they need a host capability
 * (see `RuntimeHost` in the follow-up), not a port over the client.
 *
 * Publishing a language is left out for a nearer reason: `languages.publish` takes a path to a
 * bundle *on the executor's filesystem*, and a file picker in a browser context yields a File with
 * no path to give it. The launcher's own publish form asks the user to type the path, and its
 * buttons are wired to the install handler, so it has never published anything.
 */
import { type Ad4mClient, type Apps, capSentence, ExceptionType } from '@coasys/ad4m';
import type { AuthorizedApp, RuntimeAdminPort } from '@we/backend-shared';

import type { Ad4mCapability } from './capabilities';
import { missingExecutorMethods, onMissingMethod } from './missingMethods';
import { formatNetworkMetrics } from './networkMetrics';
import { toPeerRecords } from './peerRecords';

/**
 * The languages the executor installs for itself and cannot run without.
 *
 * Hardcoded because AD4M does not report it: `languages.all()` returns the infrastructure and the
 * user's installs in one undifferentiated list. The launcher carried the same five names for the
 * same reason. The cost of it drifting is a removable badge on a language that should not be
 * removable, so `removeLanguage` refuses on this list rather than trusting the UI to hide a button.
 */
const SYSTEM_LANGUAGES = [
  'languages',
  'agent-expression-store',
  'neighbourhood-store',
  'perspective-language',
  'direct-message-language',
];

/** AD4M's `Apps` record, flattened into the contract's shape with capabilities pre-rendered. */
function toAuthorizedApp(app: Apps): AuthorizedApp {
  return {
    id: app.requestId,
    name: app.auth.appName,
    description: app.auth.appDesc,
    url: app.auth.appUrl,
    iconUrl: app.auth.appIconPath,
    // capSentence turns a capability object into the sentence the launcher's consent dialog shows.
    // Rendering here rather than in the shell keeps AD4M's capability vocabulary out of templates.
    capabilities: (app.auth.capabilities ?? []).map((cap) => capSentence(cap)),
    revoked: !!app.revoked,
  };
}

export interface Ad4mRuntimeOptions {
  /**
   * Whether this connection operates the node it reached. Defaults to true.
   *
   * False for a guest on somebody else's executor — a hosted node, or any multi-user one, which is
   * the normal web case. Declared by the connector, which is what knows how the connection was
   * obtained.
   *
   * This is **not** the permission check — {@link capabilities} is. It answers a different question:
   * whether a permitted change is an appropriate one to offer. AD4M grants a hosted guest
   * `LANGUAGE DELETE`, and removing a language plugin from a machine other people are using is a
   * button that should not exist rather than one that returns an error. So the two compose: read
   * wherever the grant allows, mutate the node only where the node is ours.
   */
  administersNode?: boolean;

  /**
   * The capability list this connection's token carries, or omitted when it cannot be read.
   *
   * Omitted means *unknown*, and is treated as "assume permitted" — a desktop host authenticating
   * with an empty token against an executor with no admin credential holds `ALL_CAPABILITY`, and
   * reading that as "no capabilities" would empty the settings page on the hosts that own the node.
   *
   * See `capabilities.ts` for why reading the grant beats inferring it.
   */
  capabilities?: Ad4mCapability[] | null;
}

export function createAd4mRuntimeAdmin(backendClient: unknown, options: Ad4mRuntimeOptions = {}): RuntimeAdminPort {
  const client = backendClient as Ad4mClient;
  const administersNode = options.administersNode ?? true;

  /**
   * What belongs to this session rather than to the node, and so survives being a guest.
   *
   * Authorized apps used to live here on the reasoning that `agent.getApps()` "answers for whoever
   * is authenticated" — it does not. The executor keeps them in a process-global map persisted to
   * one `apps_data.json`, not scoped per user, so on a shared node the list is either empty or
   * somebody else's. They have moved to the node-scoped group below, and consent has followed them.
   */
  const agentScoped: RuntimeAdminPort = {
    /*
      What this executor turned out not to have.

      Here rather than in the node-scoped group, and unconditional, because it is neither a node
      setting nor a grant: it is a reading of what *this session's* own calls have already been
      refused, and a guest on somebody else's node needs it at least as much as its operator — a
      guest is exactly who gets the degraded surface with no way to account for it.

      Answers with the AD4M-specific registry because this is the AD4M adapter; a second backend
      answers from whatever it learns the same question through, or omits the member entirely.
    */
    unsupported: () => missingExecutorMethods().map(({ method, firstSeen }) => ({ name: method, firstSeen })),
    onUnsupported: (handler) => onMissingMethod(handler),
  };

  /**
   * Answering consent requests: granting an app its capabilities, and trusting a peer.
   *
   * Node-scoped, because both answers change the node. A capability grant needs `AGENT PERMIT`,
   * which only the node's operator holds, and the trusted-agent list is one list for the whole
   * node — the executor refuses `runtime.addTrustedAgents` and `runtime.deleteTrustedAgents` to a
   * user session. A guest offered these prompts saw an "untrusted agent" request (the executor
   * still raises those to every session) whose Trust and Decline both failed.
   */
  const consent: RuntimeAdminPort = {
    /**
     * One executor subscription, demultiplexed into the contract's two request kinds. AD4M raises
     * these as `exception` events carrying the request in `addon` — a JSON blob for capability
     * requests, a bare DID for trust — which the shell relays back untouched on approve/deny.
     */
    onConsentRequest(handler) {
      return client.on('exception-occurred', ({ exception: info }) => {
        if (info.type === ExceptionType.CapabilityRequested && info.addon) {
          try {
            const auth = JSON.parse(info.addon).auth;
            handler({
              kind: 'capability',
              title: info.title,
              message: info.message,
              app: {
                name: auth.appName,
                description: auth.appDesc,
                url: auth.appUrl,
                iconUrl: auth.appIconPath,
                capabilities: (auth.capabilities ?? []).map((cap: unknown) =>
                  capSentence(cap as Parameters<typeof capSentence>[0]),
                ),
              },
              payload: info.addon,
            });
          } catch (err) {
            // A malformed request must not take down the subscription — every later consent
            // prompt would be lost with it, silently.
            console.error('ad4m runtime: could not read a capability request', err);
          }
        }

        if (info.type === ExceptionType.AgentIsUntrusted && info.addon) {
          handler({
            kind: 'trust',
            title: info.title,
            message: info.message,
            peerId: info.addon,
            payload: info.addon,
          });
        }
      });
    },

    async approve(request) {
      if (request.kind === 'capability') return client.agent.permitCapability(request.payload);
      await client.runtime.addTrustedAgents([request.payload]);
    },

    async deny(request) {
      // Capability requests need no negative acknowledgement — the asker times out, which is the
      // same outcome as the launcher's dialog being dismissed. Declining to trust a peer is
      // likewise the absence of an entry, not an entry saying "no".
      if (request.kind === 'trust') await client.runtime.deleteTrustedAgents([request.payload]);
    },
  };

  /**
   * The rest of node administration — the store, languages, trust, the peer network, and the app
   * grants the executor keeps process-wide.
   *
   * Everything here changes something every user of the node shares, so it is gated on
   * `administersNode` and not merely on the grant. AD4M's default guest capabilities include
   * `LANGUAGE DELETE`; uninstalling a language plugin from a machine other people are using is the
   * clearest example of a permitted operation that should still not be offered.
   */
  const nodeScoped: RuntimeAdminPort = {
    // ── External apps ─────────────────────────────────────────────────────────
    /**
     * AD4M returns one record per issued token, so an app that reconnected several times appears
     * several times. Collapsing by URL matches how a user thinks about it — "Flux has access", not
     * "Flux has four tokens" — and `revoke`/`remove` below re-expand it, acting on every token the
     * app holds rather than one arbitrary grant.
     *
     * Node-scoped despite reading like an agent concern: `apps_map` is one process-global map behind
     * a single `apps_data.json`, so on a multi-user node this is everyone's grants, not yours. It is
     * also always empty there, because a hosted session is minted by `generate_user_jwt` and never
     * recorded as an app at all — the section had nothing to show and no right to show it.
     */
    async authorizedApps() {
      const apps = await client.agent.getApps();
      const byUrl = new Map<string, AuthorizedApp>();
      for (const app of apps) {
        const mapped = toAuthorizedApp(app);
        const existing = byUrl.get(mapped.url);
        // A grant counts as live if any of its tokens is unrevoked.
        if (existing) existing.revoked = existing.revoked && mapped.revoked;
        else byUrl.set(mapped.url, mapped);
      }
      return [...byUrl.values()];
    },

    async revokeApp(id) {
      for (const requestId of await tokensSharingApp(client, id)) {
        await client.agent.revokeToken(requestId);
      }
    },

    async removeApp(id) {
      for (const requestId of await tokensSharingApp(client, id)) {
        await client.agent.removeApp(requestId);
      }
    },

    // ── The whole store ───────────────────────────────────────────────────────
    async exportDatabase(path) {
      await client.runtime.exportDb(path);
    },

    async importDatabase(path) {
      await client.runtime.importDb(path);
    },

    // ── Languages ─────────────────────────────────────────────────────────────
    async languages() {
      const handles = await client.languages.all();
      return handles.map((handle) => ({
        address: handle.address,
        name: handle.name,
        system: SYSTEM_LANGUAGES.includes(handle.name),
      }));
    },

    /**
     * `byAddress` is the install: asking for a language the node does not have makes it fetch and
     * install the bundle, and the handle it returns is the installed one. It reads like a getter,
     * which is exactly why it is wrapped here rather than called from the store.
     */
    async installLanguage(address) {
      await client.languages.byAddress(address);
    },

    async removeLanguage(address) {
      const handle = (await client.languages.all()).find((l) => l.address === address);
      if (handle && SYSTEM_LANGUAGES.includes(handle.name)) {
        throw new Error(`${handle.name} is part of the running node and cannot be removed`);
      }
      await client.languages.remove(address);
    },

    // ── Trust ─────────────────────────────────────────────────────────────────
    async trustedAgents() {
      return client.runtime.getTrustedAgents();
    },

    async trustAgent(id) {
      await client.runtime.addTrustedAgents([id]);
    },

    async untrustAgent(id) {
      await client.runtime.deleteTrustedAgents([id]);
    },

    // ── Peer network ──────────────────────────────────────────────────────────
    async networkMetrics() {
      return formatNetworkMetrics(await client.runtime.getNetworkMetrics());
    },

    /*
      No `restartNetwork`. The executor's `runtime.restartHolochain` handler returns true without
      restarting anything — its body stopped calling `HolochainService::restart_service()` when the
      API moved from GraphQL to WebSocket RPC — so offering it here put a button in settings that
      spun, reported success, and changed nothing. Leaving the member off makes the shell hide the
      control. Put it back, wrapping `client.runtime.restartHolochain()`, once the executor this
      package pins restarts the conductor again; expect that call to need a longer timeout than the
      client's default, since a conductor restart can outlast it.
    */

    async peerInfos() {
      return toPeerRecords(await client.runtime.hcAgentInfos());
    },

    async addPeerInfos(infos) {
      await client.runtime.hcAddAgentInfos(infos);
    },
  };

  /**
   * Assembled from what this connection may actually do.
   *
   * The store reads capability off the port's *shape* — `canManageTrust` is `!!runtime()?.trustedAgents` —
   * so omitting a group here is how a section disappears. That indirection is deliberate: the
   * neutral contract never learns AD4M's capability vocabulary, and a second backend expresses the
   * same thing by implementing the same subset.
   */
  return {
    ...agentScoped,
    ...(administersNode ? { ...nodeScoped, ...consent } : {}),
  };
}

/** Every token id belonging to the same app URL as `id`. See `authorizedApps` for why. */
async function tokensSharingApp(client: Ad4mClient, id: string): Promise<string[]> {
  const apps = await client.agent.getApps();
  const target = apps.find((a) => a.requestId === id);
  if (!target) return [id];
  return apps.filter((a) => a.auth.appUrl === target.auth.appUrl).map((a) => a.requestId);
}
