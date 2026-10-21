/**
 * Agents the backend runs: a model, on the backend, working in one dataset with the backend's own
 * tools — and with tools the app gives it for its own records.
 *
 * `LanguageModelPort.converse` lets WE run the conversation itself, calling the model one turn at a
 * time and applying what it asks for in the browser. That only works while somebody has WE open,
 * and every client that wants a model to do something has to carry the loop and the tools with it.
 * This is the other arrangement: the backend holds the loop, the tools and the writes, and WE sends
 * the conversation and reads the answer. Anything else that can reach the backend — a bot, a
 * scheduled job — can then do the same with the same rules.
 *
 * ## The app's tools travel as a bundle
 *
 * What counts as a valid template is WE's to decide, and changes with every WE release. So WE
 * hands the backend its rules as one self-contained JavaScript module (`@we/agent-tools`' bundle),
 * which the backend runs in a sandbox and offers to its agents. {@link AgentPort.provideTools} is
 * idempotent: the same build's bundle changes nothing, and a new build's replaces the old.
 *
 * ## Reads are free; edits are asked for
 *
 * An agent may read anything the caller can. It changes something only when the caller says it may
 * ({@link AgentRunRequest.mayEdit}), and then as the caller, with the caller's own permissions —
 * so letting it adds no authority, it only stops narrowing.
 */

import type { DatasetHandle } from './dataSource';

/** One turn of the conversation, as the caller holds it. */
export interface AgentTurn {
  role: 'user' | 'assistant';
  text: string;
}

export interface AgentRunRequest {
  /** The dataset the agent works in. Everything it reads and writes is here. */
  dataset: DatasetHandle;
  /** The conversation so far, the person's request last. */
  turns: AgentTurn[];
  /** The record the person is looking at, as a hint the agent starts from. */
  about?: { entity: string; id: string };
  /** Whether the agent may change the dataset, using the app's tools. Absent: it only reads. */
  mayEdit?: boolean;
  /** A model other than the backend's default, as the backend names it. */
  model?: string;
  signal?: AbortSignal;
}

export interface AgentRunReply {
  /** The agent's answer to the person. */
  text: string;
}

export interface AgentPort {
  /**
   * Give the backend's agents the app's tools: a single-file ES module exporting `toolsets`, as
   * `@we/agent-tools` builds. Resolves once they are available, whether this call installed them
   * or they already were; rejects when the backend has none and may not be given them.
   */
  provideTools(bundle: string): Promise<void>;
  /** Run an agent to its answer. */
  run(request: AgentRunRequest): Promise<AgentRunReply>;
}

/**
 * The backend cannot run this agent here — its build predates agents, or it has no app tools and
 * this session may not install them. Not a failure of the request: a caller that can do the work
 * another way does it that way, and anything else is a real error worth showing.
 */
export class AgentUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentUnavailableError';
  }
}
