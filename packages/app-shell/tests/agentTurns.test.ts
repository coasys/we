/**
 * What a backend agent is told when the editor hands it a request: the conversation as it was said,
 * without the panel's own status lines.
 */
import { describe, expect, it } from 'vitest';

import { agentTurns, type PanelMessage } from '../src/shared/agentTurns';

describe('the conversation an agent is sent', () => {
  it('is what was said, in order, the request last', () => {
    const messages: PanelMessage[] = [
      { role: 'user', content: 'Make the header blue', status: 'sent' },
      { role: 'assistant', content: 'Done — the header is blue now.' },
    ];
    expect(agentTurns(messages, 'And the footer')).toEqual([
      { role: 'user', text: 'Make the header blue' },
      { role: 'assistant', text: 'Done — the header is blue now.' },
      { role: 'user', text: 'And the footer' },
    ]);
  });

  it('leaves out the status lines the panel drew, rather than passing them on as words', () => {
    const messages: PanelMessage[] = [
      { role: 'assistant', content: 'Coloured it.\n\n<span class="success">✓ Template updated (2 changes)</span>' },
      { role: 'assistant', content: '<span class="danger">✗ Could not apply changes after multiple attempts.</span>' },
    ];
    expect(agentTurns(messages, 'Try again')).toEqual([
      { role: 'assistant', text: 'Coloured it.' },
      { role: 'user', text: 'Try again' },
    ]);
  });

  it('leaves out the panel’s notes, the request already on screen and the reply still being drawn', () => {
    const messages: PanelMessage[] = [
      { role: 'system', content: 'Switched to Timeline' },
      { role: 'user', content: 'Colour the bylines', status: 'sending' },
      { role: 'assistant', content: '', status: 'streaming' },
    ];
    expect(agentTurns(messages, 'Colour the bylines')).toEqual([{ role: 'user', text: 'Colour the bylines' }]);
  });
});
