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

/**
 * The capability refusal the last settled reply ended on, or null. Read off the reply's own error
 * or a step the backend flagged `refused` — the real "Capability is not matched" line, shown as it
 * arrived.
 */
export function refusalOf(messages: AgentConversationMessage[]): string | null {
  const reply = [...messages].reverse().find((m) => m.role === 'assistant' && m.status && m.status !== 'running');
  if (!reply) return null;
  if ((reply.error ?? '').includes(CAPABILITY_REFUSAL)) return reply.error!;
  if (reply.steps?.some((s) => s.refused)) {
    return reply.steps.find((s) => s.refused)?.error ?? CAPABILITY_REFUSAL;
  }
  return null;
}

/**
 * What the refusal card says in plain words. The raw "Capability is not matched" line stays under
 * the card's details row — the person needs the boundary, the error is for whoever is debugging it.
 */
export function refusalSentence(spaceName: string | undefined): string {
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
