/**
 * Agents the backend runs: a model, on the backend, working in one dataset with the backend's own
 * tools, WE's template tools among them.
 *
 * `LanguageModelPort.converse` lets WE run the conversation itself, calling the model one turn at a
 * time and applying what it asks for in the browser. That only works while somebody has WE open,
 * and every client that wants a model to do something has to carry the loop and the tools with it.
 * This is the other arrangement: the backend holds the loop, the tools and the writes, and WE sends
 * the conversation and reads the answer. Anything else that can reach the backend — a bot, a
 * scheduled job — can then do the same with the same rules.
 *
 * ## The backend carries WE's template tools
 *
 * What counts as a valid template is WE's to decide, and changes with every WE release. A backend
 * that offers agents runs WE's own rules for it — `@we/agent-tools`' bundle, at the release the
 * backend was built with — so an agent there edits a template by the rules the editor uses.
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
  /** Whether the agent may change the dataset, with the template tools. Absent: it only reads. */
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
  /** Run an agent to its answer. */
  run(request: AgentRunRequest): Promise<AgentRunReply>;
  /**
   * Conversations the backend keeps and runs: the backend holds the history, runs each reply
   * where it lives (so it survives the client going away), and records what the agent did as it
   * does it. Absent where the backend only runs an agent on request ({@link run}); a caller then
   * keeps the conversation itself. (Not `BackendPorts.agentSession`, which is who is signed in.)
   */
  conversations?: AgentConversationsPort;
}

/** A conversation the backend keeps: the dataset it is kept in, and its id there. */
export interface AgentConversationRef {
  dataset: DatasetHandle;
  id: string;
}

/** Where a reply is. Only `running` changes. `interrupted`: the backend stopped while it ran. */
export type AgentReplyStatus = 'running' | 'done' | 'failed' | 'cancelled' | 'interrupted';

/**
 * One tool call the agent made while writing a reply: the tool, the record it acted on (by id),
 * and how it went. Never what the call sent or got back. `stopped`: the reply ended (stopped,
 * failed, cut off by a restart) before the call returned, so it never got an outcome. A backend
 * reports that itself; a step is only ever `running` under a reply that still is.
 */
export interface AgentStep {
  tool: string;
  target?: string;
  outcome: 'running' | 'ok' | 'error' | 'stopped';
  error?: string;
}

/** One turn of a kept conversation. The agent's carry how their reply went, and its steps. */
export interface AgentConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  text: string;
  /** When it was written, in ms since the epoch. */
  createdAt: number;
  status?: AgentReplyStatus;
  error?: string;
  steps?: AgentStep[];
}

export interface AgentConversationSummary {
  ref: AgentConversationRef;
  title: string;
  /** The record the conversation is about, by id. */
  about?: string;
  createdAt: number;
}

export interface AgentConversationsPort {
  /**
   * Start a conversation kept in `keepIn`. Its replies' agent works in `workIn` and, with
   * `mayEdit`, may change it there; the backend keeps those settings with the conversation.
   */
  create(input: {
    keepIn: DatasetHandle;
    workIn: DatasetHandle;
    title?: string;
    about?: string;
    mayEdit?: boolean;
    model?: string;
  }): Promise<AgentConversationRef>;
  /** The conversations kept in `keepIn`, newest first; those about one record when `about` is given. */
  list(input: { keepIn: DatasetHandle; about?: string }): Promise<AgentConversationSummary[]>;
  /** Delete a conversation, with its messages, stopping a reply that is running. */
  delete(session: AgentConversationRef): Promise<void>;
  /**
   * Write the person's message and start the agent's reply. Resolves once both exist; the reply
   * then runs on its own, and {@link follow} reports it.
   * `about` is the record the person is looking at, a hint the agent starts from.
   */
  send(
    session: AgentConversationRef,
    text: string,
    options?: { about?: { entity: string; id: string } },
  ): Promise<void>;
  /** Stop the reply that is running. False when none was. */
  cancel(session: AgentConversationRef): Promise<boolean>;
  /** The conversation, oldest first. */
  messages(session: AgentConversationRef): Promise<AgentConversationMessage[]>;
  /**
   * Be told the conversation whenever it changes (a message, a reply's status, a step). Called with
   * the whole conversation, oldest first. Returns the way to stop.
   */
  follow(session: AgentConversationRef, onChange: (messages: AgentConversationMessage[]) => void): () => void;
}

/**
 * The backend cannot run this agent here: its build predates agents. Not a failure of the request:
 * a caller that can do the work another way does it that way, and anything else is a real error
 * worth showing.
 */
export class AgentUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'AgentUnavailableError';
  }
}
