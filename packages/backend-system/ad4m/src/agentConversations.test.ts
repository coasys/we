/**
 * Conversations the executor keeps, on AD4M — unit tests.
 *
 * - The conversation reads as neutral turns: the agent's replies with their status and steps,
 *   every other text child the person's, oldest first
 * - A step still running under a reply that has ended was cut off, and reads as stopped
 * - A conversation is created with the executor's settings: where the agent works, the person's
 *   library, and the template tools (change and make) only when it may edit
 * - A node without agent sessions says so as `AgentUnavailableError`
 */
import { AgentUnavailableError } from '@we/backend-shared';
import { describe, expect, it, vi } from 'vitest';

import { conversationOf, createAd4mAgentConversations } from './agentConversations';

const step = (
  tool: string,
  outcome: string,
  createdAt: number,
  extra: Partial<{ target: string; error: string }> = {},
) => ({
  tool,
  outcome,
  createdAt,
  target: extra.target ?? '',
  error: extra.error ?? '',
});

describe('a conversation the executor keeps', () => {
  it('reads as turns: replies with their status and steps, everything else the person’s', () => {
    const texts = [
      { id: 'm/1', text: 'make the heading bold', createdAt: 100 },
      { id: 'r/1', text: 'Done.', createdAt: 200 },
      { id: 'm/2', text: 'and italic', createdAt: 300 },
    ];
    const replies = [
      {
        id: 'r/1',
        text: 'Done.',
        createdAt: 200,
        status: 'done',
        error: '',
        steps: [
          step('template_update', 'ok', 220, { target: 'ad4m://t/1' }),
          step('template_read', 'ok', 210, { target: 'ad4m://t/1' }),
        ],
      },
      // Still running, so it has no text and is not yet among the text children.
      {
        id: 'r/2',
        text: '',
        createdAt: 400,
        status: 'running',
        error: '',
        steps: [step('template_read', 'running', 410)],
      },
    ];

    expect(conversationOf(texts, replies)).toEqual([
      { id: 'm/1', role: 'user', text: 'make the heading bold', createdAt: 100 },
      {
        id: 'r/1',
        role: 'assistant',
        text: 'Done.',
        createdAt: 200,
        status: 'done',
        steps: [
          { tool: 'template_read', target: 'ad4m://t/1', outcome: 'ok' },
          { tool: 'template_update', target: 'ad4m://t/1', outcome: 'ok' },
        ],
      },
      { id: 'm/2', role: 'user', text: 'and italic', createdAt: 300 },
      {
        id: 'r/2',
        role: 'assistant',
        text: '',
        createdAt: 400,
        status: 'running',
        steps: [{ tool: 'template_read', outcome: 'running' }],
      },
    ]);
  });

  it('carries a failure and its step error, and reads an unknown status as running', () => {
    const [failed, odd] = conversationOf(
      [],
      [
        {
          id: 'r/1',
          text: '',
          createdAt: 1,
          status: 'failed',
          error: 'credits ran out',
          steps: [step('template_update', 'error', 2, { error: 'the template changed' })],
        },
        { id: 'r/2', text: '', createdAt: 3, status: 'something-new', error: '', steps: [] },
      ],
    );
    expect(failed).toMatchObject({
      status: 'failed',
      error: 'credits ran out',
      steps: [{ tool: 'template_update', outcome: 'error', error: 'the template changed' }],
    });
    expect(odd.status).toBe('running');
  });

  it('reports a step the reply’s end cut off as stopped, and a running reply’s as running', () => {
    const steps = [step('template_read', 'ok', 2), step('template_update', 'running', 3)];
    const [stopped, running] = conversationOf(
      [],
      [
        { id: 'r/1', text: '', createdAt: 1, status: 'cancelled', error: '', steps },
        { id: 'r/2', text: '', createdAt: 4, status: 'running', error: '', steps },
      ],
    );
    expect(stopped.steps?.map((s) => s.outcome)).toEqual(['ok', 'stopped']);
    expect(running.steps?.map((s) => s.outcome)).toEqual(['ok', 'running']);
  });

  it('creates a conversation with the settings the executor keeps', async () => {
    const agentSessionCreate = vi.fn().mockResolvedValue({ sessionId: 'ad4m://agent_session/1' });
    const keepIn = { agentSessionCreate };
    const workIn = { uuid: 'space-perspective' };
    const conversations = createAd4mAgentConversations();

    const library = { uuid: 'root-perspective' };
    const ref = await conversations.create({
      keepIn,
      workIn,
      library,
      title: 'Chat 1',
      about: 't/1',
      mayEdit: true,
    });
    expect(ref).toEqual({ dataset: keepIn, id: 'ad4m://agent_session/1' });
    expect(agentSessionCreate).toHaveBeenCalledWith({
      title: 'Chat 1',
      about: 't/1',
      workIn: 'space-perspective',
      library: 'root-perspective',
      writeTools: ['template_update', 'template_create'],
      model: undefined,
    });

    await conversations.create({ keepIn, workIn });
    const readOnly = agentSessionCreate.mock.calls[1][0];
    expect(readOnly.writeTools).toBeUndefined();
    expect(readOnly).not.toHaveProperty('library');
  });

  it('cancels the running reply of the conversation', async () => {
    const agentReplyCancel = vi.fn().mockResolvedValue(true);
    const conversations = createAd4mAgentConversations();
    await expect(conversations.cancel({ dataset: { agentReplyCancel }, id: 's/1' })).resolves.toBe(true);
    expect(agentReplyCancel).toHaveBeenCalledWith('s/1');
  });

  it('reports a node without agent sessions as unavailable', async () => {
    const conversations = createAd4mAgentConversations();
    const agentSessionCreate = vi.fn().mockRejectedValue(new Error('Unknown type: perspective.agentSessionCreate'));
    await expect(
      conversations.create({ keepIn: { agentSessionCreate }, workIn: { uuid: 'w' } }),
    ).rejects.toBeInstanceOf(AgentUnavailableError);
  });
});
