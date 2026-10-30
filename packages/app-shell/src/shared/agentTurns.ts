/**
 * agentTurns — the editor's chat, as the conversation a backend agent reads.
 *
 * Framework-free, so the part that decides what the agent is told can be tested without the store.
 */
import type { AgentTurn } from '@we/backend-shared';

/** A chat message as the editor panel holds it. */
export interface PanelMessage {
  role: 'user' | 'assistant' | 'system';
  content: string;
  status?: 'sending' | 'streaming' | 'sent' | 'error';
}

/**
 * A status line the panel draws around a reply — "✓ Template updated", a warning, a failure. Each is
 * one span with a class, and nothing a person or the model said is written that way.
 */
const STATUS_LINE = /<span class="[^"]*">[^<]*<\/span>/g;

/**
 * The conversation as the agent reads it: what was said, in order, the request last. The panel's
 * own notes, the request already on screen as `sending`, and the reply still being drawn are left
 * out — the first are not what anybody said, the other two are not finished.
 */
export function agentTurns(messages: readonly PanelMessage[], latest: string): AgentTurn[] {
  const turns: AgentTurn[] = [];
  for (const msg of messages) {
    if (msg.role === 'system' || msg.status === 'sending' || msg.status === 'streaming') continue;
    const text = msg.content.replace(STATUS_LINE, '').trim();
    if (text) turns.push({ role: msg.role, text });
  }
  turns.push({ role: 'user', text: latest });
  return turns;
}
