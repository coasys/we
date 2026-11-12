/**
 * The agent-conversations adapter on `ai.session*` — unit tests against a fake AI client.
 *
 * - Transcript rows become neutral turns: user messages, reply rows with status + steps grouped
 *   by the turn that made them, and a `running` step under a settled reply reported `stopped`
 * - Steps mark their outcome, carry the refusal the capability boundary produced, and a call that
 *   wrote is flagged so the surface can mark it orange
 * - Scope maps to capabilities: a space chat pins the perspective and defaults to it, a global one
 *   asks for nothing (which is everything the caller holds)
 * - `list` reads scope back off the session; `follow` merges the first read with live events
 *   without letting the fetch downgrade a settled row
 * - A node without `ai.session*` answers `AgentUnavailableError`
 */
import { AgentUnavailableError } from '@we/backend-shared';
import { describe, expect, it, vi } from 'vitest';

import { conversationOf, createAd4mAgentConversations, isWriteTool, scopeOf } from '../src/agentConversations';

let seq = 0;
const row = (partial: Record<string, unknown>) =>
  ({
    id: `m${++seq}`,
    sessionId: 's1',
    seq: partial.seq ?? seq,
    role: 'user',
    content: {},
    status: null,
    error: null,
    createdAt: '2026-01-01T00:00:00.000Z',
    ...partial,
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  }) as any;

const text = (t: string) => ({ text: t });
const tool = (name: string, extra?: Record<string, unknown>) => ({ name, arguments: {}, ...extra });

describe('conversationOf', () => {
  it('builds turns from user rows, reply rows and the tool rows between them', () => {
    const messages = conversationOf([
      row({ role: 'user', content: text('what changed?'), seq: 1 }),
      row({ role: 'tool', content: tool('describe_perspective'), status: 'done', seq: 2 }),
      row({ role: 'tool', content: tool('instance_create'), status: 'done', seq: 3 }),
      row({ role: 'assistant', content: text('A new task.'), status: 'done', seq: 4 }),
      row({ role: 'user', content: text('thanks'), seq: 5 }),
      row({ role: 'assistant', content: text('Any time.'), status: 'done', seq: 6 }),
    ]);

    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    const reply = messages[1];
    expect(reply.status).toBe('done');
    expect(reply.text).toBe('A new task.');
    expect(reply.steps?.map((s) => s.tool)).toEqual(['describe_perspective', 'instance_create']);
    // Steps land under the reply of the turn that made them — the second reply made none.
    expect(messages[3].steps).toEqual([]);
  });

  it('maps reply statuses and carries the error a settled row gives', () => {
    const messages = conversationOf([
      row({ role: 'user', content: text('q'), seq: 1 }),
      row({ role: 'assistant', content: text(''), status: 'failed', error: 'model exploded', seq: 2 }),
    ]);
    expect(messages[1].status).toBe('failed');
    expect(messages[1].error).toBe('model exploded');

    for (const [given, want] of [
      ['running', 'running'],
      ['cancelled', 'cancelled'],
      ['interrupted', 'interrupted'],
      ['something-new', 'running'],
    ] as const) {
      const msgs = conversationOf([
        row({ role: 'user', content: text('q'), seq: 1 }),
        row({ role: 'assistant', content: text(''), status: given, seq: 2 }),
      ]);
      expect(msgs[1].status).toBe(want);
    }
  });

  it('reports a step still running under a settled reply as stopped', () => {
    const messages = conversationOf([
      row({ role: 'user', content: text('q'), seq: 1 }),
      row({ role: 'tool', content: tool('query_links'), status: 'running', seq: 2 }),
      row({ role: 'assistant', content: text('done'), status: 'done', seq: 3 }),
    ]);
    expect(messages[1].steps?.[0].outcome).toBe('stopped');
  });

  it('keeps a running step running while the reply is', () => {
    const messages = conversationOf([
      row({ role: 'user', content: text('q'), seq: 1 }),
      row({ role: 'tool', content: tool('query_links'), status: 'running', seq: 2 }),
      row({ role: 'assistant', content: text(''), status: 'running', seq: 3 }),
    ]);
    expect(messages[1].steps?.[0].outcome).toBe('running');
  });

  it('marks a failed step, and a capability refusal by name', () => {
    const messages = conversationOf([
      row({ role: 'user', content: text('q'), seq: 1 }),
      row({
        role: 'tool',
        content: tool('describe_perspective', { perspective_id: 'other-space' }),
        status: 'failed',
        error: 'Capability is not matched',
        seq: 2,
      }),
      row({ role: 'assistant', content: text('I cannot.'), status: 'done', seq: 3 }),
    ]);
    const step = messages[1].steps![0];
    expect(step.outcome).toBe('error');
    expect(step.refused).toBe(true);
    expect(step.error).toBe('Capability is not matched');
  });

  it('flags a call that wrote, so the surface can mark it', () => {
    const messages = conversationOf([
      row({ role: 'user', content: text('q'), seq: 1 }),
      row({ role: 'tool', content: tool('instance_create'), status: 'done', seq: 2 }),
      row({ role: 'tool', content: tool('add_link'), status: 'done', seq: 3 }),
      row({ role: 'tool', content: tool('list_perspectives'), status: 'done', seq: 4 }),
      row({ role: 'assistant', content: text('made it'), status: 'done', seq: 5 }),
    ]);
    expect(messages[1].steps?.map((s) => s.wrote ?? false)).toEqual([true, true, false]);
  });
});

describe('isWriteTool', () => {
  it('reads read-prefixes as reads and everything else as a write', () => {
    for (const read of [
      'list_perspectives',
      'get_links',
      'query_links',
      'describe_perspective',
      'instance_query',
      'template_read',
    ]) {
      expect(isWriteTool(read)).toBe(false);
    }
    for (const write of [
      'instance_create',
      'instance_update',
      'instance_remove',
      'add_link',
      'remove_link',
      'template_update',
      'new_tool_x',
    ]) {
      expect(isWriteTool(write)).toBe(true);
    }
  });
});

describe('scopeOf', () => {
  it('reads the perspective a session is pinned to, and none when it is not', () => {
    expect(
      scopeOf({
        capabilities: [{ with: { domain: 'perspective', pointers: ['uuid-1'] }, can: ['READ'] }],
        defaultPerspective: 'uuid-1',
      } as never),
    ).toEqual({ perspectiveUuid: 'uuid-1' });
    expect(scopeOf({ capabilities: [], defaultPerspective: null } as never)).toBeUndefined();
  });
});

function fakeAi() {
  return {
    sessionCreate: vi.fn(async (input: Record<string, unknown>) => ({
      id: 'sess-new',
      ownerDid: null,
      title: (input.title as string) ?? '',
      model: null,
      defaultPerspective: (input.defaultPerspective as string | null) ?? null,
      libraryPerspective: null,
      capabilities: (input.capabilities as unknown[]) ?? [],
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
    })),
    sessionList: vi.fn(async () => [
      {
        id: 'global-1',
        title: 'Everything',
        capabilities: [],
        defaultPerspective: null,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
      {
        id: 'space-1',
        title: 'Garden club',
        capabilities: [{ with: { domain: 'perspective', pointers: ['uuid-9'] }, can: ['READ'] }],
        defaultPerspective: 'uuid-9',
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-02T00:00:00.000Z',
      },
    ]),
    sessionUpdate: vi.fn(async () => ({})),
    sessionDelete: vi.fn(async () => true),
    sendMessage: vi.fn(async () => ({ messageId: 'm1', replyId: 'r1' })),
    cancelTurn: vi.fn(async () => true),
    sessionMessages: vi.fn(async () => []),
    onSessionChanged: vi.fn(() => () => {}),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe('the AD4M conversations port', () => {
  it('creates a global session with no capabilities — everything the caller holds', async () => {
    const ai = fakeAi();
    const port = createAd4mAgentConversations({ ai } as never);
    const ref = await port.create({ title: 'All of it' });
    expect(ref.id).toBe('sess-new');
    const input = ai.sessionCreate.mock.calls[0][0];
    expect(input.title).toBe('All of it');
    expect(input.capabilities).toBeUndefined();
    expect(input.defaultPerspective).toBeNull();
  });

  it('creates a space session pinned to its perspective, and defaults there', async () => {
    const ai = fakeAi();
    const port = createAd4mAgentConversations({ ai } as never);
    await port.create({ title: 'Garden', scope: { perspectiveUuid: 'uuid-9' } });
    const input = ai.sessionCreate.mock.calls[0][0];
    expect(input.capabilities).toEqual([
      {
        with: { domain: 'perspective', pointers: ['uuid-9'] },
        can: ['READ', 'CREATE', 'UPDATE', 'DELETE', 'SUBSCRIBE'],
      },
    ]);
    expect(input.defaultPerspective).toBe('uuid-9');
  });

  it('lists global and space conversations together, scope on the scoped one', async () => {
    const port = createAd4mAgentConversations({ ai: fakeAi() } as never);
    const list = await port.list();
    expect(list.map((s) => s.ref.id)).toEqual(['space-1', 'global-1']); // newest first
    expect(list[0].scope).toEqual({ perspectiveUuid: 'uuid-9' });
    expect(list[1].scope).toBeUndefined();
  });

  it('sends, cancels, reads and deletes through the session calls', async () => {
    const ai = fakeAi();
    const port = createAd4mAgentConversations({ ai } as never);
    await expect(port.send({ id: 's1' }, 'hi')).resolves.toBe('r1');
    expect(ai.sendMessage).toHaveBeenCalledWith('s1', 'hi');
    await expect(port.cancel({ id: 's1' })).resolves.toBe(true);
    expect(ai.cancelTurn).toHaveBeenCalledWith('s1');
    await port.delete({ id: 's1' });
    expect(ai.sessionDelete).toHaveBeenCalledWith('s1');
    await port.messages({ id: 's1' });
    expect(ai.sessionMessages).toHaveBeenCalledWith('s1');
  });

  it('pushes the conversation on each change, merging events with the first read', async () => {
    let handler: ((event: unknown) => void) | undefined;
    const firstRows = [
      row({ id: 'm1', role: 'user', content: text('q'), seq: 1 }),
      row({ id: 'm2', role: 'assistant', content: text('working'), status: 'running', seq: 2 }),
    ];
    const ai = {
      ...fakeAi(),
      sessionMessages: vi.fn(async () => firstRows),
      onSessionChanged: vi.fn((h: (e: unknown) => void) => {
        handler = h;
        return () => {};
      }),
    };
    const port = createAd4mAgentConversations({ ai } as never);
    const pushes: string[][] = [];
    port.follow({ id: 's1' }, (messages) => pushes.push(messages.map((m) => `${m.role}:${m.status ?? ''}`)));

    await vi.waitFor(() => expect(pushes.length).toBe(1));
    expect(pushes[0]).toEqual(['user:', 'assistant:running']);

    handler!({
      sessionId: 's1',
      kind: 'message',
      session: null,
      message: row({ id: 'm2', role: 'assistant', content: text('done!'), status: 'done', seq: 2 }),
    });
    expect(pushes[1]).toEqual(['user:', 'assistant:done']);

    // An event for another session is not this conversation's.
    handler!({
      sessionId: 'other',
      kind: 'message',
      session: null,
      message: row({ role: 'user', content: text('x'), seq: 9 }),
    });
    expect(pushes.length).toBe(2);
  });

  it('answers a node without ai.session* as unavailable', async () => {
    const ai = fakeAi();
    ai.sessionList = vi.fn(async () => {
      throw new Error('Unknown type: ai.sessionList');
    });
    const port = createAd4mAgentConversations({ ai } as never);
    await expect(port.list()).rejects.toBeInstanceOf(AgentUnavailableError);
  });
});
