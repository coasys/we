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
 */
import { type Ad4mClient, type Apps, capSentence, ExceptionType } from '@coasys/ad4m';
import type { AuthorizedApp, ConsentRequest, RuntimeAdminPort } from '@we/backend-shared';

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

export function createAd4mRuntimeAdmin(backendClient: unknown): RuntimeAdminPort {
  const client = backendClient as Ad4mClient;

  return {
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
      return client.runtime.getNetworkMetrics();
    },

    async restartNetwork() {
      await client.runtime.restartHolochain();
    },

    async peerInfos() {
      return client.runtime.hcAgentInfos();
    },

    async addPeerInfos(infos) {
      await client.runtime.hcAddAgentInfos(infos);
    },

    // ── External apps ─────────────────────────────────────────────────────────
    /**
     * AD4M returns one record per issued token, so an app that reconnected several times appears
     * several times. Collapsing by URL matches how a user thinks about it — "Flux has access", not
     * "Flux has four tokens" — and `revoke`/`remove` below re-expand it, acting on every token the
     * app holds rather than one arbitrary grant.
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

    // ── Consent ───────────────────────────────────────────────────────────────
    /**
     * One executor subscription, demultiplexed into the contract's two request kinds. AD4M raises
     * these as `exception` events carrying the request in `addon` — a JSON blob for capability
     * requests, a bare DID for trust — which the shell relays back untouched on approve/deny.
     *
     * `addExceptionCallback` has no documented unsubscribe, so the returned function flips a local
     * flag instead: after it runs, later events are dropped rather than delivered to a handler the
     * caller has discarded.
     */
    onConsentRequest(handler) {
      let live = true;

      client.runtime.addExceptionCallback((info) => {
        if (!live) return null;

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

        return null;
      });

      return () => {
        live = false;
      };
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
}

/** Every token id belonging to the same app URL as `id`. See `authorizedApps` for why. */
async function tokensSharingApp(client: Ad4mClient, id: string): Promise<string[]> {
  const apps = await client.agent.getApps();
  const target = apps.find((a) => a.requestId === id);
  if (!target) return [id];
  return apps.filter((a) => a.auth.appUrl === target.auth.appUrl).map((a) => a.requestId);
}
