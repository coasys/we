import type { Ad4mClient, PerspectiveProxy } from '@coasys/ad4m';
import { type AgentPort, AgentUnavailableError } from '@we/backend-shared';

import { recordMissingMethod } from './missingMethods';

/**
 * The executor's agent sessions, as the neutral agent port.
 *
 * An app's tools reach an executor agent through one fixed MCP tool, `call_record_tool`, which
 * takes the app's tool by name — so "the agent may edit with the app's tools" is that one tool
 * being allowed to write. Every tool that only reads is offered regardless.
 */
const APP_WRITE_TOOLS = ['call_record_tool'];

/**
 * The executor stops a session after fifteen minutes; waiting a little longer than that means its
 * own answer, rather than a client timeout, is what gets reported.
 */
const RUN_TIMEOUT_MS = 16 * 60_000;

export function createAd4mAgentPort(backendClient: unknown): AgentPort {
  const client = backendClient as Ad4mClient;
  /*
    One install per bundle per session. The executor would treat a repeat as a no-op, but the
    bundle is a couple of megabytes, and every editor request would otherwise send it again.
  */
  let provided: { bundle: string; done: Promise<void> } | null = null;

  return {
    provideTools(bundle) {
      if (provided && provided.bundle === bundle) return provided.done;
      const done = install(client, bundle);
      provided = { bundle, done };
      // A failed install is not remembered, so the next request tries again.
      done.catch(() => {
        if (provided?.done === done) provided = null;
      });
      return done;
    },

    async run({ dataset, turns, about, mayEdit, model, signal }) {
      try {
        const reply = await (dataset as PerspectiveProxy).runAgent(
          turns.map((turn) => ({ role: turn.role, content: turn.text })),
          {
            context: about ? { entity: about.entity, recordId: about.id } : undefined,
            writeTools: mayEdit ? APP_WRITE_TOOLS : undefined,
            model,
          },
          { signal, timeoutMs: RUN_TIMEOUT_MS },
        );
        return { text: reply.text };
      } catch (error) {
        if (recordMissingMethod(error)) {
          throw new AgentUnavailableError('This node cannot run agents yet.');
        }
        throw error;
      }
    },
  };
}

async function install(client: Ad4mClient, bundle: string): Promise<void> {
  try {
    await client.toolBundles.install(bundle);
  } catch (error) {
    if (recordMissingMethod(error)) {
      throw new AgentUnavailableError('This node cannot run app tools yet.');
    }
    /*
      A user session on a shared node may not install code every agent there would run. That is
      the node's rule, not a failure: the work is done another way.
    */
    if (/user session may not call it/i.test(error instanceof Error ? error.message : String(error))) {
      throw new AgentUnavailableError('This node does not let this session install app tools.');
    }
    throw error;
  }
}
