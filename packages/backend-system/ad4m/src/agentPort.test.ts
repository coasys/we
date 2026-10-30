/**
 * The agent port on AD4M — unit tests.
 *
 * - A run sends the turns, the record as context, and lets the agent write with the template tools
 *   only when asked
 * - A node without agent sessions says so as `AgentUnavailableError`
 */
import { AgentUnavailableError } from '@we/backend-shared';
import { describe, expect, it, vi } from 'vitest';

import { createAd4mAgentPort } from './agentPort';

describe('the AD4M agent port', () => {
  it('runs an agent on the record, writing only when asked', async () => {
    const runAgent = vi.fn().mockResolvedValue({ text: 'Made the heading bold.' });
    const port = createAd4mAgentPort();
    const reply = await port.run({
      dataset: { runAgent },
      turns: [
        { role: 'user', text: 'make it bold' },
        { role: 'assistant', text: 'Which heading?' },
        { role: 'user', text: 'the first' },
      ],
      about: { entity: 'Template', id: 'ad4m://obj/t1' },
      mayEdit: true,
    });

    expect(reply).toEqual({ text: 'Made the heading bold.' });
    const [messages, settings] = runAgent.mock.calls[0];
    expect(messages).toEqual([
      { role: 'user', content: 'make it bold' },
      { role: 'assistant', content: 'Which heading?' },
      { role: 'user', content: 'the first' },
    ]);
    expect(settings).toEqual({
      context: { entity: 'Template', recordId: 'ad4m://obj/t1' },
      writeTools: ['template_update'],
      model: undefined,
    });

    await port.run({ dataset: { runAgent }, turns: [{ role: 'user', text: 'what is this?' }] });
    expect(runAgent.mock.calls[1][1]).toEqual({ context: undefined, writeTools: undefined, model: undefined });
  });

  it('reports a node without agent sessions as unavailable', async () => {
    const port = createAd4mAgentPort();
    const runAgent = vi.fn().mockRejectedValue(new Error('Unknown type: perspective.runAgent'));
    await expect(port.run({ dataset: { runAgent }, turns: [{ role: 'user', text: 'hi' }] })).rejects.toBeInstanceOf(
      AgentUnavailableError,
    );
  });
});
