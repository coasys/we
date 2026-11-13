/**
 * The reads `AgentChat` makes off a conversation's messages — kept pure so the "working" state, the
 * capability refusal and the resend text have a testable home outside the component.
 */
import type { AgentConversationMessage } from '@we/backend-shared';

/** The executor's name for a call refused because the session may not reach that perspective. */
export const CAPABILITY_REFUSAL = 'Capability is not matched';

/** A reply is still working — what shows the spinner and swaps Send for Stop. */
export function replyRunning(messages: AgentConversationMessage[]): boolean {
  return messages.some((m) => m.role === 'assistant' && m.status === 'running');
}

/** What the last turn asked with — the text "Send again" and "Ask in the global chat" resend. */
export function lastAsk(messages: AgentConversationMessage[]): string {
  const users = messages.filter((m) => m.role === 'user');
  return users[users.length - 1]?.text ?? '';
}

/** A perspective id where an error names one — the executor spells them out in refusals. */
const UUID_IN_TEXT = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i;

/**
 * Whether a refused step reached past the chat's own boundary. In the global chat every refusal is
 * the account's boundary, so it counts. In a space chat only a refusal naming *another*
 * perspective does: a step refused for an agent-wide tool (no uuid, or this space's own) is the
 * boundary being narrower than the tool, not the reply having reached outside the space — and a
 * reply that went on to answer shows no card for it.
 */
function reachedOutside(error: string | undefined, perspectiveUuid: string | undefined): boolean {
  if (!perspectiveUuid) return true;
  const named = error?.match(UUID_IN_TEXT)?.[0];
  return named !== undefined && named.toLowerCase() !== perspectiveUuid.toLowerCase();
}

/**
 * The capability refusal the last settled reply ended on, or null. Read off the reply's own
 * `refused` mark — the backend's flag that the reply itself was refused — or a step that reached
 * outside the chat's own perspective. A refused step recovered from inside the space (its reply
 * answered anyway) names nothing foreign and shows no card.
 */
export function refusalOf(messages: AgentConversationMessage[], perspectiveUuid?: string): string | null {
  const reply = [...messages].reverse().find((m) => m.role === 'assistant' && m.status && m.status !== 'running');
  if (!reply) return null;
  // The flag is the adapter's word; the error itself is what every adapter wrote before it — read
  // either as the reply itself refused.
  if (reply.refused || (reply.error ?? '').includes(CAPABILITY_REFUSAL)) {
    return reply.error ?? CAPABILITY_REFUSAL;
  }
  const outside = reply.steps?.find((s) => s.refused && reachedOutside(s.error, perspectiveUuid));
  return outside ? (outside.error ?? CAPABILITY_REFUSAL) : null;
}

/**
 * What the refusal card says in plain words. The raw "Capability is not matched" line stays under
 * the card's details row — the person needs the boundary, the error is for whoever is debugging it.
 *
 * `scoped` picks the words: a space chat's refusal is the boundary doing its job, so it names the
 * space it may not leave. A global chat has no such boundary — a refusal there means the account
 * itself may not reach what was asked, and space wording would only misreport it.
 */
export function refusalSentence(spaceName: string | undefined, scoped: boolean): string {
  if (!scoped) {
    return 'The chat was refused access — it reached for something this account may not use.';
  }
  return `This chat can only use ${spaceName?.trim() || 'this space'}. It was refused access to another space.`;
}

/** How a reply that did not finish ended, in the words the chat says it. */
export function unfinishedWords(status: string): string | undefined {
  return (
    {
      failed: 'The reply failed',
      cancelled: 'Stopped',
      interrupted: 'Stopped when the node restarted',
    } as Record<string, string>
  )[status];
}
