import { Flag, Model, Property } from '@coasys/ad4m';
import { WeNode } from '@we/models';

/**
 * A single message in an assistant {@link Thread}. Belongs to the same
 * (neighbourhood) perspective as its thread.
 *
 * `threadId` is the canonical join back to the owning Thread and is what the UI
 * queries on — every message MUST carry it. The Thread also links messages via a
 * HasMany relation for ORM navigation, but `threadId` is the source of truth for
 * "which thread is this in", so a backend only needs to set this one scalar.
 *
 * `role` is 'user' | 'assistant' | 'tool' | 'system'.
 * `toolCalls` is an optional JSON-encoded array describing tool invocations/results
 *   (see the AssistantStore doc for the shape the UI renders).
 * `ts` is an ISO-8601 timestamp (lexicographically sortable → chronological order).
 * `status` is '' | 'streaming' | 'complete' | 'error'. While an assistant reply is
 *   being produced the backend sets 'streaming' and appends to `content`; the UI
 *   subscription re-renders on each update, giving a live token stream. The backend
 *   flips it to 'complete' when done.
 */
@Model({ name: 'Message' })
export class Message extends WeNode {
  @Flag({ through: 'we://flag', value: 'we://module/assistant/message' })
  flag: string = '';

  @Property({ through: 'we://module/assistant/thread_id' })
  threadId: string = '';

  @Property({ through: 'we://role' })
  role: string = '';

  @Property({ through: 'we://content' })
  content: string = '';

  /** Optional JSON-encoded array of tool invocations/results. */
  @Property({ through: 'we://module/assistant/tool_calls' })
  toolCalls: string = '';

  @Property({ through: 'we://module/assistant/ts' })
  ts: string = '';

  @Property({ through: 'we://status' })
  status: string = '';
}
