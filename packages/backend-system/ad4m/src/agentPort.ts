import type { PerspectiveProxy } from '@coasys/ad4m';
import { type AgentPort, AgentUnavailableError } from '@we/backend-shared';

import { recordMissingMethod } from './missingMethods';

/**
 * The executor's agent sessions, as the neutral agent port.
 *
 * The executor carries WE's template tools as two MCP tools, `template_read` and
 * `template_update`. Every tool that only reads is offered to a session regardless, so "the agent
 * may edit" is `template_update` being allowed to write.
 */
const EDIT_TOOLS = ['template_update'];

/**
 * The executor stops a session after fifteen minutes; waiting a little longer than that means its
 * own answer, rather than a client timeout, is what gets reported.
 */
const RUN_TIMEOUT_MS = 16 * 60_000;

export function createAd4mAgentPort(): AgentPort {
  return {
    async run({ dataset, turns, about, mayEdit, model, signal }) {
      try {
        const reply = await (dataset as PerspectiveProxy).runAgent(
          turns.map((turn) => ({ role: turn.role, content: turn.text })),
          {
            context: about ? { entity: about.entity, recordId: about.id } : undefined,
            writeTools: mayEdit ? EDIT_TOOLS : undefined,
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
