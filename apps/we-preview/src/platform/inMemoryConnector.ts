import type { BackendConnector, BackendInitResult } from '@we/app-shell/shared';
import { createInMemoryBackendPorts } from '@we/backend-inmemory';

/**
 * The whole difference between this host and we-web.
 *
 * we-web's connector runs AD4M's connect choreography — an auth UI, a token, a hosted node — and
 * returns a client. This returns the in-memory bundle and nothing else, which is what makes the
 * app boot in a headless browser with no executor, no agent setup and no network.
 *
 * The agent starts **unlocked**. A locked one is the honest default for the port (and what the boot
 * suite exercises), but here it would put a password prompt in front of every screenshot. The lock
 * flow is a shell surface like any other; a fixture that wants to photograph it can ask for one.
 *
 * `runtime`, `transcription` and `interop` are absent, exactly as `createInMemoryBackendPorts`
 * leaves them. They are feature-detected member by member, so the settings surfaces that would use
 * them render their capability-gated empty states — see the preview host's README for what that
 * means for anyone pointing this at shell design work rather than at templates.
 */
export const inMemoryConnector: BackendConnector = {
  async initialize(ctx): Promise<BackendInitResult> {
    const ports = createInMemoryBackendPorts(ctx, {
      agent: { id: 'did:preview:me', unlocked: true },
    });

    return { client: {}, ports };
  },
};
