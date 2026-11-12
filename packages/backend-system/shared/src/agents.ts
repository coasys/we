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

/** A conversation the backend keeps, as the caller names it. */
export interface AgentConversationRef {
  /**
   * The dataset the conversation is kept in, where the backend keeps conversations in one.
   * Absent where the backend keeps them beside it instead — ad4m's `ai.session*` rows live in
   * the executor's own store, not in any perspective, so its refs carry only `id`.
   */
  dataset?: DatasetHandle;
  id: string;
}

/** How far a kept conversation's tools may reach. */
export interface AgentConversationScope {
  /**
   * The one perspective the conversation's tools may touch; absent means it reaches everything
   * the caller's token does. What a "this space only" chat carries and a global chat leaves out.
   */
  perspectiveUuid?: string;
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
  /** The thing the call aimed at — a record id, a perspective uuid — where the backend knows it. */
  target?: string;
  outcome: 'running' | 'ok' | 'error' | 'stopped';
  error?: string;
  /**
   * The call changed something rather than only reading it — create, update, delete, add_link,
   * template_update and their kin. Set after the fact so a surface can mark it.
   */
  wrote?: boolean;
  /** The backend refused the call outright — e.g. a capability the session does not hold. */
  refused?: boolean;
  /** A short digest of what came back, where the backend reports one — "3 spaces", "2 found". */
  summary?: string;
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
  /** The record the conversation is about, by id, where the backend keeps one. */
  about?: string;
  /** How far the conversation's tools reach — set for a space chat, absent for a global one. */
  scope?: AgentConversationScope;
  createdAt: number;
  /** When it last changed, in ms since the epoch — a fresher sort than `createdAt` where kept. */
  updatedAt?: number;
}

export interface AgentConversationsPort {
  /**
   * Start a conversation the backend keeps. Its replies' agent works inside `scope` — one
   * perspective, or everything the caller's token reaches when `scope` is absent; the backend
   * keeps that setting with the conversation.
   *
   * `keepIn`/`workIn`/`about`/`mayEdit` belong to backends that keep conversations inside a
   * dataset (see coasys/we#416); a backend that keeps them beside the data ignores them and
   * reads `scope` instead.
   */
  create(input: {
    keepIn?: DatasetHandle;
    workIn?: DatasetHandle;
    title?: string;
    about?: string;
    mayEdit?: boolean;
    model?: string;
    scope?: AgentConversationScope;
  }): Promise<AgentConversationRef>;
  /**
   * Every conversation the caller can see, newest first — those about one record when `about`
   * is given, those kept in one dataset when `keepIn` is and the backend keeps them there.
   */
  list(input?: { keepIn?: DatasetHandle; about?: string }): Promise<AgentConversationSummary[]>;
  /** Rename or re-scope a kept conversation. Absent where the backend keeps no update call. */
  update?(session: AgentConversationRef, input: { title?: string }): Promise<void>;
  /** Delete a conversation, with its messages, stopping a reply that is running. */
  delete(session: AgentConversationRef): Promise<void>;
  /**
   * Write the person's message and start the agent's reply. Resolves once both exist — with the
   * reply's id where the backend assigns one; the reply then runs on its own, and {@link follow}
   * reports it.
   * `about` is the record the person is looking at, a hint the agent starts from.
   */
  send(
    session: AgentConversationRef,
    text: string,
    options?: { about?: { entity: string; id: string } },
  ): Promise<string | void>;
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
