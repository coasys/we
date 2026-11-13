import type { Ad4mClient } from '@coasys/ad4m';
// The session types exist in the package but its `generated/api` barrel does not re-export them
// yet — deep type imports until it does.
import type { AISession } from '@coasys/ad4m/lib/src/generated/api/AISession';
import type { AISessionMessage } from '@coasys/ad4m/lib/src/generated/api/AISessionMessage';
import {
  type AgentConversationMessage,
  type AgentConversationScope,
  type AgentConversationsPort,
  type AgentConversationSummary,
  type AgentReplyStatus,
  type AgentStep,
  AgentUnavailableError,
} from '@we/backend-shared';

import { recordMissingMethod } from './missingMethods';

/**
 * Conversations the executor keeps and runs, as the neutral conversations port.
 *
 * A conversation is an executor `ai.session*` row in the executor's own store — not a record in
 * any perspective — which is why the refs this file hands out carry only `id`. The transcript is
 * `ai_messages` rows: the person's turns, the assistant's reply rows (each `running` until it
 * ends), and `role: 'tool'` rows for every call the turn made, grouped into a turn by the user
 * message that opened it. This file is the only place that knows those shapes: everything above
 * it reads neutral turns.
 */

/** The reach a "this space only" chat asks for: every right, on the one perspective. */
const SCOPED_CAN = ['READ', 'CREATE', 'UPDATE', 'DELETE', 'SUBSCRIBE'];

/**
 * The shape a perspective uuid takes — what `perspective.add` hands out. Anything else in a scope
 * (`'*'`, `''`, a shared-url, a record id) is not a perspective the session may be pinned to: a
 * `'*'` through would be a grant over every perspective — the exact opposite of the pin asked for.
 */
const PLAIN_UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;

/** The reply's ending, read off its row. Anything unrecognised is treated as still going. */
const STATUSES: readonly AgentReplyStatus[] = ['running', 'done', 'failed', 'cancelled', 'interrupted'];

/*
 * Whether a call changed something rather than only looked — the orange mark a reply's steps
 * carry. The executor knows its own read/write lists and says so on the step row as `writes`
 * (ad4m #1713); only a row from before that field needs the name to answer.
 *
 * The name check reads the *verb*, not the class: dynamic tools name themselves `<class>_<verb>`
 * (`textblock_query`, `space_get_name`), and a prefix match on the class marked `hashtag_create`
 * a read and `readmarker_create` beside `listing_create` whichever way the class happened to
 * start. The unknown-default-is-write side is deliberate: a new write tool nobody listed still
 * gets its orange mark, while a new read tool marked orange is only a lie about risk.
 */

/** Reads that name no class at all — the static tools, exactly. */
const STATIC_READS = new Set([
  'flow_state',
  'flow_actions',
  'flow_valid_outputs',
  'auth_status',
  'language_meta',
  'instance_get',
  'instance_query',
  'instance_transcript',
  'get_children',
]);

/** Reads that lead with the verb — `list_perspectives`, `get_links`. */
const READ_PREFIX = /^(list|get|query|describe)_/;

/** The verbs a dynamic class tool reads with — `textblock_query`, `space_get_name`. */
const READ_VERBS = new Set(['get', 'query', 'list']);

/**
 * Whether a tool call wrote — `writes` off the step row where the executor says it, the name's
 * verb where it does not.
 */
export function isWriteTool(tool: string, writes?: boolean): boolean {
  if (writes !== undefined) return writes;
  if (STATIC_READS.has(tool) || READ_PREFIX.test(tool)) return false;
  const verb = tool.split('_')[1] ?? tool;
  return !READ_VERBS.has(verb);
}

/** The payload a transcript row carries. */
interface RowContent {
  text?: string;
  name?: string;
  arguments?: Record<string, unknown>;
  target?: string;
  result?: string;
  error?: string;
  /**
   * The executor's own read/write call on the tool — present on nodes running ad4m #1713's row
   * shape, absent on older ones, where the name's verb answers instead.
   */
  writes?: boolean;
}

const content = (row: AISessionMessage): RowContent => row.content ?? {};

/**
 * What a step aimed at. `content.target` first — the executor's own field for it — then the
 * perspective the call named, so a step shows the space it went into.
 */
function stepTarget(row: RowContent): string | undefined {
  return row.target ?? (typeof row.arguments?.perspective_id === 'string' ? row.arguments.perspective_id : undefined);
}

/** A short digest of what a step got back: a count for a list, the head of a string. */
function summarize(result: unknown): string | undefined {
  if (typeof result !== 'string' || !result) return undefined;
  try {
    const parsed: unknown = JSON.parse(result);
    if (Array.isArray(parsed)) return `${parsed.length} ${parsed.length === 1 ? 'result' : 'results'}`;
    if (parsed && typeof parsed === 'object') return undefined;
    return String(parsed).slice(0, 60);
  } catch {
    return result.length > 60 ? `${result.slice(0, 57)}…` : result;
  }
}

/**
 * A tool row's outcome under its reply. The executor never writes one for a call the reply's end
 * cut off (a cancel aborts the task mid-call): that step stays `running` under a reply that is
 * not, and is reported as `stopped`.
 */
function stepOutcome(status: string | null, reply: AgentReplyStatus): AgentStep['outcome'] {
  if (status === 'done') return 'ok';
  if (status === 'failed') return 'error';
  if (status === 'cancelled' || status === 'interrupted') return 'stopped';
  return reply === 'running' ? 'running' : 'stopped';
}

function toStep(row: AISessionMessage, reply: AgentReplyStatus): AgentStep {
  const c = content(row);
  const outcome = stepOutcome(row.status, reply);
  const refused = outcome === 'error' && (row.error ?? c.error ?? '').includes('Capability is not matched');
  const error = row.error ?? c.error;
  const summary = summarize(c.result);
  return {
    tool: c.name ?? 'tool',
    ...(stepTarget(c) ? { target: stepTarget(c) } : {}),
    outcome,
    ...(error ? { error } : {}),
    ...(isWriteTool(c.name ?? '', c.writes) && outcome === 'ok' ? { wrote: true } : {}),
    ...(refused ? { refused: true } : {}),
    ...(summary ? { summary } : {}),
  };
}

const toMs = (iso: string): number => {
  const ms = Date.parse(iso);
  return Number.isNaN(ms) ? 0 : ms;
};

const replyStatus = (status: string | null): AgentReplyStatus =>
  STATUSES.includes(status as AgentReplyStatus) ? (status as AgentReplyStatus) : 'running';

/**
 * The transcript as neutral turns, oldest first: a reply row is the agent's turn, with its status
 * and the tool rows it made — which land *after* it, in `seq` order, so each reply keeps only the
 * steps that followed it. One turn can hold more than one reply row — a reply that failed and was
 * tried again — and the turn-grouping that gave every reply every step showed one row's calls
 * under the other.
 */
export function conversationOf(rows: AISessionMessage[]): AgentConversationMessage[] {
  const sorted = [...rows].sort((a, b) => a.seq - b.seq);
  const out: AgentConversationMessage[] = [];
  // The reply the next tool row belongs to — reset by a user message, replaced by each reply row.
  let reply: AgentConversationMessage | undefined;
  for (const row of sorted) {
    if (row.role === 'user') {
      reply = undefined;
      out.push({ id: row.id, role: 'user', text: content(row).text ?? '', createdAt: toMs(row.createdAt) });
    } else if (row.role === 'assistant') {
      const status = replyStatus(row.status);
      const error = row.error ?? undefined;
      const refused = status !== 'running' && (error ?? '').includes('Capability is not matched');
      reply = {
        id: row.id,
        role: 'assistant',
        text: content(row).text ?? '',
        createdAt: toMs(row.createdAt),
        status,
        ...(error ? { error } : {}),
        ...(refused ? { refused: true } : {}),
        steps: [],
      };
      out.push(reply);
    } else if (row.role === 'tool') {
      // A tool row before any reply has nothing to hang on — dropped, as before.
      reply?.steps?.push(toStep(row, reply.status!));
    }
  }
  return out;
}

/**
 * The perspective a session's capabilities pin it to — absent when it is not pinned.
 *
 * A wildcard is a grant over every perspective, not one: a `'*'` domain (the admin's), or a
 * perspective cap whose pointers hold `'*'` — which is exactly what the hosted default carries
 * (`perspective` CREATE plus `perspective_query` over `['*']`). Reading `'*'` as a uuid would put
 * the global chat's sessions inside a space named `*`, so scoped is only what the capabilities say
 * plainly: every perspective cap names the same single uuid, and nothing grants wider.
 */
export function scopeOf(
  session: Pick<AISession, 'capabilities' | 'defaultPerspective'>,
): AgentConversationScope | undefined {
  let uuid: string | undefined;
  for (const cap of session.capabilities ?? []) {
    const resource = cap.with;
    /*
      One capability outside the space-only grant is enough: a session that also holds `agent:*`
      reaches the person, not just the space, and wearing the lock would lie about what it can do.
      Every cap must be exactly the space's own — the perspective domain, that one perspective as
      its only pointer, and only the verbs a space chat is created with.
    */
    if (resource?.domain !== 'perspective') return undefined;
    if (resource.pointers.length !== 1 || resource.pointers[0] === '*') return undefined;
    if (!cap.can?.length || cap.can.some((verb) => !SCOPED_CAN.includes(verb))) return undefined;
    if (uuid === undefined) uuid = resource.pointers[0];
    else if (uuid !== resource.pointers[0]) return undefined;
  }
  return uuid ? { perspectiveUuid: uuid } : undefined;
}

/** Run a call to the executor, answering a node without `ai.session*` as `AgentUnavailableError`. */
async function onNode<T>(call: () => Promise<T>): Promise<T> {
  try {
    return await call();
  } catch (error) {
    if (recordMissingMethod(error)) {
      throw new AgentUnavailableError('This node does not keep AI sessions yet.');
    }
    throw error;
  }
}

export function createAd4mAgentConversations(client: Ad4mClient): AgentConversationsPort {
  const ai = client.ai;

  /** The transcript, whole — `sessionMessages` pages newest-first, 200 rows a read by default. */
  async function allMessages(sessionId: string, stopped?: () => boolean): Promise<AISessionMessage[]> {
    const out: AISessionMessage[] = [];
    let before: number | undefined;
    for (;;) {
      if (stopped?.()) return out;
      const page = await onNode(() =>
        ai.sessionMessages(sessionId, { limit: 200, ...(before !== undefined ? { before } : {}) }),
      );
      out.unshift(...page);
      if (page.length < 200) return out;
      before = page[0].seq;
    }
  }

  const conversations: AgentConversationsPort = {
    async create({ title, model, scope }) {
      const uuid = scope?.perspectiveUuid;
      /*
        Refuse an unusable scope outright. A `'*'` sent on would be granted verbatim — a chat asked
        for one space becoming a chat over all of them — and an empty or wrongly-shaped value is
        just as unable to name the perspective intended. Not this adapter's to widen or drop.
      */
      if (uuid !== undefined && !PLAIN_UUID.test(uuid)) {
        throw new Error(`a space chat needs a perspective uuid; "${uuid}" is not one`);
      }
      const session = await onNode(() =>
        ai.sessionCreate({
          title,
          model,
          defaultPerspective: uuid ?? null,
          capabilities: uuid ? [{ with: { domain: 'perspective', pointers: [uuid] }, can: SCOPED_CAN }] : undefined,
        }),
      );
      return { id: session.id };
    },

    async list() {
      const rows = await onNode(() => ai.sessionList());
      return rows
        .map((row): AgentConversationSummary => ({
          ref: { id: row.id },
          title: row.title,
          ...(scopeOf(row) ? { scope: scopeOf(row) } : {}),
          createdAt: toMs(row.createdAt),
          updatedAt: toMs(row.updatedAt),
        }))
        .sort((a, b) => (b.updatedAt ?? b.createdAt) - (a.updatedAt ?? a.createdAt));
    },

    async update(session, input) {
      if (input.title !== undefined) {
        await onNode(() => ai.sessionUpdate(session.id, { title: input.title }));
      }
    },

    async delete(session) {
      await onNode(() => ai.sessionDelete(session.id));
    },

    async send(session, text) {
      const started = await onNode(() => ai.sendMessage(session.id, text));
      return started.replyId;
    },

    async cancel(session) {
      return onNode(() => ai.cancelTurn(session.id));
    },

    async messages(session) {
      return conversationOf(await allMessages(session.id));
    },

    follow(session, onChange) {
      let stopped = false;
      /*
        Nothing is said until the first read lands: events arriving before it are kept but held,
        so nobody is shown a transcript the subscription built up piecemeal.
      */
      let ready = false;
      const rows = new Map<string, AISessionMessage>();
      const emit = () => {
        if (!stopped && ready) onChange(conversationOf([...rows.values()]));
      };

      const unsubscribe = ai.onSessionChanged((event) => {
        if (stopped || event.sessionId !== session.id) return;
        if (event.kind === 'deleted') {
          // The conversation is gone — that is a complete answer, first read or not.
          rows.clear();
          ready = true;
          emit();
          stopped = true;
          unsubscribe();
          return;
        }
        if (event.kind === 'message' && event.message) {
          rows.set(event.message.id, event.message);
          emit();
          schedule();
        }
      });

      /*
        A reply marked `running` is asked for again every few seconds until it is not — the poll
        is what reconnect hands back to: events the socket missed never arrive, but the read sees
        the settle that happened while it was down. A read that itself fails (the socket still
        down) is not the end: the reply still says running, so the poll stays armed.
      */
      const POLL_MS = 3000;
      let timer: ReturnType<typeof setTimeout> | undefined;
      const running = () => [...rows.values()].some((row) => row.role === 'assistant' && row.status === 'running');
      const schedule = () => {
        if (stopped || timer !== undefined || !running()) return;
        timer = setTimeout(() => {
          timer = undefined;
          void read().then(schedule);
        }, POLL_MS);
      };

      async function read() {
        try {
          const page = await allMessages(session.id, () => stopped);
          for (const row of page) {
            const seen = rows.get(row.id);
            /*
              Statuses only move forward (running → a settled end), so a snapshot taken before a
              settle event must not downgrade the row the event already delivered.
            */
            if (seen && seen.status !== 'running' && row.status === 'running') continue;
            rows.set(row.id, row);
          }
          ready = true;
          emit();
        } catch (error: unknown) {
          if (!stopped) {
            console.warn('agent conversations: could not read the conversation', error);
          }
        }
      }

      void read().then(schedule);

      return () => {
        stopped = true;
        if (timer !== undefined) clearTimeout(timer);
        unsubscribe();
      };
    },
  };
  return conversations;
}
