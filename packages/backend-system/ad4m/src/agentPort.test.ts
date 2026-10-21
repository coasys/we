/**
 * The agent port on AD4M — unit tests.
 *
 * - The app's tools are installed once per bundle, and tried again after a failed install
 * - A node that may not or cannot take them says so as `AgentUnavailableError`, not a failure
 * - A run sends the turns, the record as context, and lets the agent write with the app's tools
 *   only when asked
 * - A node without agent sessions says so as `AgentUnavailableError`
 */
import { AgentUnavailableError } from '@we/backend-shared';
import { describe, expect, it, vi } from 'vitest';

import { createAd4mAgentPort } from './agentPort';

function mockClient(install: () => Promise<unknown> = () => Promise.resolve({ address: 'Qm1', toolsets: [] })) {
  return { toolBundles: { install: vi.fn(install), list: vi.fn().mockResolvedValue([]) } };
}

describe('the AD4M agent port', () => {
  it('installs the app tools once per bundle', async () => {
    const client = mockClient();
    const port = createAd4mAgentPort(client);
    await port.provideTools('bundle-a');
    await port.provideTools('bundle-a');
    expect(client.toolBundles.install).toHaveBeenCalledTimes(1);

    await port.provideTools('bundle-b');
    expect(client.toolBundles.install).toHaveBeenCalledTimes(2);
    expect(client.toolBundles.install).toHaveBeenLastCalledWith('bundle-b');
  });

  it('tries again after an install that failed', async () => {
    let fail = true;
    const client = mockClient(() => (fail ? Promise.reject(new Error('busy')) : Promise.resolve({})));
    const port = createAd4mAgentPort(client);
    await expect(port.provideTools('bundle')).rejects.toThrow('busy');
    fail = false;
    await port.provideTools('bundle');
    expect(client.toolBundles.install).toHaveBeenCalledTimes(2);
  });

  it('reports a node that will not or cannot take the tools as unavailable', async () => {
    const refused = createAd4mAgentPort(
      mockClient(() =>
        Promise.reject(new Error('toolBundles.install acts on the node itself, so a user session may not call it')),
      ),
    );
    await expect(refused.provideTools('bundle')).rejects.toBeInstanceOf(AgentUnavailableError);

    const old = createAd4mAgentPort(mockClient(() => Promise.reject(new Error('Unknown type: toolBundles.install'))));
    await expect(old.provideTools('bundle')).rejects.toBeInstanceOf(AgentUnavailableError);
  });

  it('runs an agent on the record, writing only when asked', async () => {
    const runAgent = vi.fn().mockResolvedValue({ text: 'Made the heading bold.' });
    const port = createAd4mAgentPort(mockClient());
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
      writeTools: ['call_record_tool'],
      model: undefined,
    });

    await port.run({ dataset: { runAgent }, turns: [{ role: 'user', text: 'what is this?' }] });
    expect(runAgent.mock.calls[1][1]).toEqual({ context: undefined, writeTools: undefined, model: undefined });
  });

  it('reports a node without agent sessions as unavailable', async () => {
    const port = createAd4mAgentPort(mockClient());
    const runAgent = vi.fn().mockRejectedValue(new Error('Unknown type: perspective.runAgent'));
    await expect(port.run({ dataset: { runAgent }, turns: [{ role: 'user', text: 'hi' }] })).rejects.toBeInstanceOf(
      AgentUnavailableError,
    );
  });
});
