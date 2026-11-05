import {
  AgentReplyRecord,
  AgentSessionRecord,
  type AgentStepRecord,
  Link,
  LinkQuery,
  type PerspectiveProxy,
  TextContent,
} from '@coasys/ad4m';
import {
  type AgentConversationMessage,
  type AgentConversationRef,
  type AgentConversationsPort,
  type AgentConversationSummary,
  type AgentReplyStatus,
  type AgentStep,
  AgentUnavailableError,
} from '@we/backend-shared';

import { AD4M_CONTAINMENT_PREDICATE } from './containment';
import { TextBlock } from './entities';
import { recordMissingMethod } from './missingMethods';

/**
 * Conversations the executor keeps and runs, as the neutral conversations port.
 *
 * A conversation is an executor `AgentSession` record in the dataset that keeps it. The person's
 * messages are WE `TextBlock`s under it (its `ad4m://has_child` children), which the executor reads
 * as `TextContent`. The agent's turns are the executor's own `AgentReply` records beside them, each
 * with its status and steps. This file is the only place that knows those classes: everything
 * above it reads neutral turns.
 */

/** The tool an agent that may edit is given: WE's template tool, on the record it is pointed at. */
const EDIT_TOOLS = ['template_update'];

const STATUSES: readonly AgentReplyStatus[] = ['running', 'done', 'failed', 'cancelled', 'interrupted'];
const OUTCOMES: readonly string[] = ['running', 'ok', 'error'];

/** What a row of the conversation carries, read from the executor's classes. */
export interface TextRow {
  id: string;
  text: string;
  createdAt: number;
}
export interface ReplyRow extends TextRow {
  status: string;
  error: string;
  steps: { tool: string; target: string; outcome: string; error: string; createdAt: number }[];
}

/**
 * The conversation as neutral turns, oldest first: a reply is the agent's, with its status and
 * steps in the order they were made; every other text child is the person's.
 */
export function conversationOf(texts: TextRow[], replies: ReplyRow[]): AgentConversationMessage[] {
  const byId = new Map(replies.map((reply) => [reply.id, reply]));
  const seen = new Set<string>();
  const turns: AgentConversationMessage[] = [];
  // A reply may have no text yet, so it can be missing from the text children: read both.
  for (const row of [...texts, ...replies.filter((reply) => !texts.some((t) => t.id === reply.id))]) {
    if (seen.has(row.id)) continue;
    seen.add(row.id);
    const reply = byId.get(row.id);
    if (!reply) {
      turns.push({ id: row.id, role: 'user', text: row.text, createdAt: row.createdAt });
      continue;
    }
    const status = (STATUSES as readonly string[]).includes(reply.status)
      ? (reply.status as AgentReplyStatus)
      : 'running';
    turns.push({
      id: reply.id,
      role: 'assistant',
      text: reply.text,
      createdAt: reply.createdAt,
      status,
      ...(reply.error ? { error: reply.error } : {}),
      steps: [...reply.steps]
        .sort((a, b) => a.createdAt - b.createdAt)
        .map((step) => ({
          tool: step.tool,
          ...(step.target ? { target: step.target } : {}),
          outcome: stepOutcome(step.outcome, status),
          ...(step.error ? { error: step.error } : {}),
        })),
    });
  }
  return turns.sort((a, b) => a.createdAt - b.createdAt);
}

/**
 * A step's outcome under its reply. The executor never writes one for a call the reply's end cut
 * off (a cancel aborts the task mid-call): that step stays `running` under a reply that is not, and
 * is reported as `stopped`.
 */
function stepOutcome(outcome: string, reply: AgentReplyStatus): AgentStep['outcome'] {
  const known = OUTCOMES.includes(outcome) ? (outcome as AgentStep['outcome']) : 'running';
  return known === 'running' && reply !== 'running' ? 'stopped' : known;
}

function textRow(row: { id: string; text?: string; createdAt?: number | string }): TextRow {
  return { id: row.id, text: row.text ?? '', createdAt: Number(row.createdAt ?? 0) };
}

function replyRow(reply: AgentReplyRecord): ReplyRow {
  return {
    ...textRow(reply),
    status: reply.status,
    error: reply.error,
    steps: (reply.steps ?? []).map((step: AgentStepRecord) => ({
      tool: step.tool,
      target: step.target,
      outcome: step.outcome,
      error: step.error,
      createdAt: Number(step.createdAt ?? 0),
    })),
  };
}

const proxy = (session: AgentConversationRef) => session.dataset as PerspectiveProxy;

async function texts(session: AgentConversationRef): Promise<TextRow[]> {
  const rows = await TextContent.findAll(proxy(session), { parent: { id: session.id } });
  return rows.map(textRow);
}

/** The conversation's replies. None before the first: the class is registered with it. */
async function replies(session: AgentConversationRef): Promise<ReplyRow[]> {
  try {
    const rows = await AgentReplyRecord.findAll(proxy(session), {
      parent: { id: session.id },
      include: { steps: true },
    });
    return rows.map(replyRow);
  } catch {
    return [];
  }
}

/** Run a call to the executor, answering a node without the methods as `AgentUnavailableError`. */
async function onNode<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (recordMissingMethod(error)) throw new AgentUnavailableError('This node does not keep agent sessions yet.');
    throw error;
  }
}

export function createAd4mAgentConversations(): AgentConversationsPort {
  const conversations: AgentConversationsPort = {
    async create({ keepIn, workIn, title, about, mayEdit, model }) {
      const { sessionId } = await onNode(() =>
        (keepIn as PerspectiveProxy).agentSessionCreate({
          title,
          about,
          workIn: (workIn as PerspectiveProxy).uuid,
          writeTools: mayEdit ? EDIT_TOOLS : undefined,
          model,
        }),
      );
      return { dataset: keepIn, id: sessionId };
    },

    async list({ keepIn, about }) {
      let rows: AgentSessionRecord[];
      try {
        rows = await AgentSessionRecord.findAll(keepIn as PerspectiveProxy, about ? { where: { about } } : {});
      } catch {
        // Nothing kept here yet: the class is registered with the first session.
        return [];
      }
      return rows
        .map((row): AgentConversationSummary => ({
          ref: { dataset: keepIn, id: row.id },
          title: row.title,
          ...(row.about ? { about: row.about } : {}),
          createdAt: Number(row.createdAt ?? 0),
        }))
        .sort((a, b) => b.createdAt - a.createdAt);
    },

    async delete(session) {
      // The person's messages are WE's records, so WE removes them; the executor removes the
      // session, its replies and their steps.
      const p = proxy(session);
      const ownReplies = new Set((await replies(session)).map((reply) => reply.id));
      for (const row of await texts(session)) {
        if (ownReplies.has(row.id)) continue;
        const links = await p.get(new LinkQuery({ source: row.id }));
        if (links.length) await p.removeLinks(links);
      }
      await onNode(() => p.agentSessionDelete(session.id));
    },

    async send(session, text, options) {
      const p = proxy(session);
      const line = new TextBlock(p);
      line.text = text;
      await line.save();
      await p.add(new Link({ source: session.id, predicate: AD4M_CONTAINMENT_PREDICATE, target: line.id }));
      const about = options?.about;
      await onNode(() =>
        p.agentReply(session.id, about ? { context: { entity: about.entity, recordId: about.id } } : {}),
      );
    },

    async cancel(session) {
      return onNode(() => proxy(session).agentReplyCancel(session.id));
    },

    async messages(session) {
      const [textRows, replyRows] = await Promise.all([texts(session), replies(session)]);
      return conversationOf(textRows, replyRows);
    },

    follow(session, onChange) {
      const p = proxy(session);
      let latestTexts: TextRow[] = [];
      let latestReplies: ReplyRow[] = [];
      let stopped = false;
      const emit = () => {
        if (!stopped) onChange(conversationOf(latestTexts, latestReplies));
      };

      const textQuery = TextContent.query(p).parent(session.id);
      let replyQuery: { dispose(): void } | undefined;
      // The reply class exists once the first reply does, so its subscription starts then: tried
      // now, and again whenever the conversation changes until it holds.
      const followReplies = async () => {
        if (replyQuery || stopped) return;
        const query = AgentReplyRecord.query(p).parent(session.id).include({ steps: true });
        try {
          const first = await query.subscribe((rows) => {
            latestReplies = rows.map(replyRow);
            emit();
          });
          if (stopped) {
            query.dispose();
            return;
          }
          replyQuery = query;
          latestReplies = first.map(replyRow);
          emit();
        } catch {
          query.dispose();
        }
      };

      void textQuery
        .subscribe((rows) => {
          latestTexts = rows.map(textRow);
          emit();
          void followReplies();
        })
        .then((first) => {
          latestTexts = first.map(textRow);
          emit();
          return followReplies();
        })
        .catch((error: unknown) => console.warn('agent conversations: could not follow the conversation', error));

      return () => {
        stopped = true;
        textQuery.dispose();
        replyQuery?.dispose();
      };
    },
  };
  return conversations;
}
