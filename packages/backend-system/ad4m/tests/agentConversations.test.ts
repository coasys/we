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

/** Perspective-uuid-shaped ids — `create` refuses anything that is not one. */
const SPACE_A = 'a1a2a3a4-b1b2-c3c4-d5d6-e7e8e9f0a1b2';
const SPACE_B = 'b1b2b3b4-c1c2-d3d4-e5e6-f7f8f9a0b1c2';

describe('conversationOf', () => {
  it('builds turns from user rows, reply rows and the tool rows that follow them', () => {
    // The executor's order: the user message, the reply row, then the tool rows that reply made.
    const messages = conversationOf([
      row({ role: 'user', content: text('what changed?'), seq: 1 }),
      row({ role: 'assistant', content: text('A new task.'), status: 'done', seq: 2 }),
      row({ role: 'tool', content: tool('describe_perspective'), status: 'done', seq: 3 }),
      row({ role: 'tool', content: tool('instance_create'), status: 'done', seq: 4 }),
      row({ role: 'user', content: text('thanks'), seq: 5 }),
      row({ role: 'assistant', content: text('Any time.'), status: 'done', seq: 6 }),
    ]);

    expect(messages.map((m) => m.role)).toEqual(['user', 'assistant', 'user', 'assistant']);
    const reply = messages[1];
    expect(reply.status).toBe('done');
    expect(reply.text).toBe('A new task.');
    expect(reply.steps?.map((s) => s.tool)).toEqual(['describe_perspective', 'instance_create']);
    // Steps land under the reply that made them — the second reply made none.
    expect(messages[3].steps).toEqual([]);
  });

  it('gives each reply of a turn only the steps that followed it', () => {
    // A reply that failed and was tried again is two reply rows in one turn; the turn-grouping
    // that gave every reply every step showed the retry's calls under the failure too.
    const messages = conversationOf([
      row({ role: 'user', content: text('q'), seq: 1 }),
      row({ role: 'assistant', content: text(''), status: 'failed', seq: 2 }),
      row({ role: 'tool', content: tool('instance_create'), status: 'done', seq: 3 }),
      row({ role: 'assistant', content: text('done this time'), status: 'done', seq: 4 }),
      row({ role: 'tool', content: tool('add_link'), status: 'done', seq: 5 }),
    ]);

    expect(messages[1].steps?.map((s) => s.tool)).toEqual(['instance_create']);
    expect(messages[2].steps?.map((s) => s.tool)).toEqual(['add_link']);
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
      row({ role: 'assistant', content: text('done'), status: 'done', seq: 2 }),
      row({ role: 'tool', content: tool('query_links'), status: 'running', seq: 3 }),
    ]);
    expect(messages[1].steps?.[0].outcome).toBe('stopped');
  });

  it('keeps a running step running while the reply is', () => {
    const messages = conversationOf([
      row({ role: 'user', content: text('q'), seq: 1 }),
      row({ role: 'assistant', content: text(''), status: 'running', seq: 2 }),
      row({ role: 'tool', content: tool('query_links'), status: 'running', seq: 3 }),
    ]);
    expect(messages[1].steps?.[0].outcome).toBe('running');
  });

  it('marks a failed step, and a capability refusal by name', () => {
    const messages = conversationOf([
      row({ role: 'user', content: text('q'), seq: 1 }),
      row({ role: 'assistant', content: text('I cannot.'), status: 'done', seq: 2 }),
      row({
        role: 'tool',
        content: tool('describe_perspective', { perspective_id: 'other-space' }),
        status: 'failed',
        error: 'Capability is not matched',
        seq: 3,
      }),
    ]);
    const step = messages[1].steps![0];
    expect(step.outcome).toBe('error');
    expect(step.refused).toBe(true);
    expect(step.error).toBe('Capability is not matched');
  });

  it('flags a call that wrote, so the surface can mark it', () => {
    const messages = conversationOf([
      row({ role: 'user', content: text('q'), seq: 1 }),
      row({ role: 'assistant', content: text('made it'), status: 'done', seq: 2 }),
      row({ role: 'tool', content: tool('instance_create'), status: 'done', seq: 3 }),
      row({ role: 'tool', content: tool('add_link'), status: 'done', seq: 4 }),
      row({ role: 'tool', content: tool('list_perspectives'), status: 'done', seq: 5 }),
    ]);
    expect(messages[1].steps?.map((s) => s.wrote ?? false)).toEqual([true, true, false]);
  });

  it('marks a write by the row’s own `writes` flag where the executor says it', () => {
    const messages = conversationOf([
      row({ role: 'user', content: text('q'), seq: 1 }),
      row({ role: 'assistant', content: text(''), status: 'running', seq: 2 }),
      row({ role: 'tool', content: tool('space_get_name', { writes: true }), status: 'done', seq: 3 }),
      row({ role: 'tool', content: tool('instance_create', { writes: false }), status: 'done', seq: 4 }),
    ]);
    expect(messages[1].steps?.map((s) => s.wrote ?? false)).toEqual([true, false]);
  });
});

describe('isWriteTool', () => {
  it('takes the executor’s own call where the step row carries one', () => {
    // `writes` is ad4m #1713's answer: it decides even against what the name suggests.
    expect(isWriteTool('space_get_name', true)).toBe(true);
    expect(isWriteTool('instance_create', false)).toBe(false);
    expect(isWriteTool('readmarker_create', false)).toBe(false);
  });

  it('reads the static read tools, exactly', () => {
    for (const read of [
      'list_perspectives',
      'get_links',
      'query_links',
      'describe_perspective',
      'instance_query',
      'instance_transcript',
      'get_children',
      'flow_state',
      'flow_actions',
      'flow_valid_outputs',
      'auth_status',
      'language_meta',
    ]) {
      expect(isWriteTool(read)).toBe(false);
    }
  });

  it('reads a class tool by the verb after its name, not by the name’s start', () => {
    // Dynamic tools name themselves `<class>_<verb>` — the class is not the verb.
    for (const read of ['textblock_query', 'space_get_name', 'channel_list', 'readmarker_query']) {
      expect(isWriteTool(read)).toBe(false);
    }
    for (const write of [
      'readmarker_create',
      'listing_create',
      'hashtag_create',
      'textblock_set_title',
      'channel_add_member',
      'note_remove_tag',
      'space_delete',
      // A name that says nothing is treated as a write — the orange mark errs on the safe side.
      'new_tool_x',
      'mystery',
    ]) {
      expect(isWriteTool(write)).toBe(true);
    }
  });
});

describe('scopeOf', () => {
  it('reads the perspective a session is pinned to, and none when it is not', () => {
    expect(
      scopeOf({
        capabilities: [
          {
            with: { domain: 'perspective', pointers: [SPACE_A] },
            can: ['READ', 'CREATE', 'UPDATE', 'DELETE', 'SUBSCRIBE'],
          },
        ],
        defaultPerspective: SPACE_A,
      } as never),
    ).toEqual({ perspectiveUuid: SPACE_A });
    expect(scopeOf({ capabilities: [], defaultPerspective: null } as never)).toBeUndefined();
  });

  it('reads the hosted defaults as global — `*` is a grant over every space, not a space', () => {
    // The shape a token made from `get_user_default_capabilities` carries.
    expect(
      scopeOf({
        capabilities: [
          { with: { domain: 'perspective', pointers: ['*'] }, can: ['CREATE'] },
          { with: { domain: 'perspective', pointers: ['*'] }, can: ['READ'] },
        ],
        defaultPerspective: null,
      } as never),
    ).toBeUndefined();
    // And the admin's everything.
    expect(
      scopeOf({
        capabilities: [{ with: { domain: '*', pointers: ['*'] }, can: ['*'] }],
        defaultPerspective: null,
      } as never),
    ).toBeUndefined();
  });

  it('stays global when two caps pin different perspectives — there is no honest answer', () => {
    expect(
      scopeOf({
        capabilities: [
          { with: { domain: 'perspective', pointers: [SPACE_A] }, can: ['READ'] },
          { with: { domain: 'perspective', pointers: [SPACE_B] }, can: ['UPDATE'] },
        ],
        defaultPerspective: null,
      } as never),
    ).toBeUndefined();
  });

  it('refuses the lock for a session that also reaches elsewhere — one cap outside is enough', () => {
    // A session another app made: pinned to the space AND able to act as the person. Only a chat
    // whose every cap is the space-only grant may wear "this space only" — the wider one is not.
    expect(
      scopeOf({
        capabilities: [
          {
            with: { domain: 'perspective', pointers: [SPACE_A] },
            can: ['READ', 'CREATE', 'UPDATE', 'DELETE', 'SUBSCRIBE'],
          },
          { with: { domain: 'agent', pointers: ['*'] }, can: ['READ'] },
        ],
        defaultPerspective: SPACE_A,
      } as never),
    ).toBeUndefined();
  });

  it('refuses the lock when a cap is wider than the space-only grant, however it is wider', () => {
    const scopedCap = () => ({
      with: { domain: 'perspective', pointers: [SPACE_A] },
      can: ['READ', 'CREATE', 'UPDATE', 'DELETE', 'SUBSCRIBE'],
    });
    // More verbs than a space chat is created with.
    expect(
      scopeOf({
        capabilities: [{ ...scopedCap(), can: [...scopedCap().can, 'ADMIN'] }],
        defaultPerspective: SPACE_A,
      } as never),
    ).toBeUndefined();
    // More than the one pointer — several spaces is not this space only.
    expect(
      scopeOf({
        capabilities: [{ with: { domain: 'perspective', pointers: [SPACE_A, SPACE_B] }, can: scopedCap().can }],
        defaultPerspective: SPACE_A,
      } as never),
    ).toBeUndefined();
    // No verbs at all names no space-only grant either.
    expect(
      scopeOf({
        capabilities: [{ with: { domain: 'perspective', pointers: [SPACE_A] }, can: [] }],
        defaultPerspective: SPACE_A,
      } as never),
    ).toBeUndefined();
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
        capabilities: [
          {
            with: { domain: 'perspective', pointers: [SPACE_A] },
            can: ['READ', 'CREATE', 'UPDATE', 'DELETE', 'SUBSCRIBE'],
          },
        ],
        defaultPerspective: SPACE_A,
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
    await port.create({ title: 'Garden', scope: { perspectiveUuid: SPACE_A } });
    const input = ai.sessionCreate.mock.calls[0][0];
    expect(input.capabilities).toEqual([
      {
        with: { domain: 'perspective', pointers: [SPACE_A] },
        can: ['READ', 'CREATE', 'UPDATE', 'DELETE', 'SUBSCRIBE'],
      },
    ]);
    expect(input.defaultPerspective).toBe(SPACE_A);
  });

  it('refuses a scope that is not a perspective uuid — it never reaches the executor', async () => {
    // `*` granted verbatim would be a chat over every space — the opposite of the pin asked for.
    // An empty or wrongly-shaped value is just as unable to name the space; none is widened or
    // dropped to global.
    const ai = fakeAi();
    const port = createAd4mAgentConversations({ ai } as never);
    for (const bad of ['*', '', 'we://a1a2a3a4', 'uuid-9', 'a space']) {
      await expect(port.create({ title: 'x', scope: { perspectiveUuid: bad } })).rejects.toThrow(
        'a space chat needs a perspective uuid',
      );
    }
    expect(ai.sessionCreate).not.toHaveBeenCalled();
  });

  it('lists global and space conversations together, scope on the scoped one', async () => {
    const port = createAd4mAgentConversations({ ai: fakeAi() } as never);
    const list = await port.list();
    expect(list.map((s) => s.ref.id)).toEqual(['space-1', 'global-1']); // newest first
    expect(list[0].scope).toEqual({ perspectiveUuid: SPACE_A });
    expect(list[1].scope).toBeUndefined();
  });

  it('sends, cancels and deletes through the session calls', async () => {
    const ai = fakeAi();
    const port = createAd4mAgentConversations({ ai } as never);
    await expect(port.send({ id: 's1' }, 'hi')).resolves.toBe('r1');
    expect(ai.sendMessage).toHaveBeenCalledWith('s1', 'hi');
    await expect(port.cancel({ id: 's1' })).resolves.toBe(true);
    expect(ai.cancelTurn).toHaveBeenCalledWith('s1');
    await port.delete({ id: 's1' });
    expect(ai.sessionDelete).toHaveBeenCalledWith('s1');
  });

  it('reads the transcript whole — a full page is followed by the page before it', async () => {
    // `sessionMessages` answers at most `limit` rows, newest first; a longer conversation used to
    // lose everything before the latest 200 without a word said. `follow`'s first read pages back.
    const oldRows = [row({ role: 'user', content: text('first'), seq: 1 })];
    const page = Array.from({ length: 200 }, (_, i) => row({ role: 'user', content: text(`m${i + 2}`), seq: i + 2 }));
    const ai = {
      ...fakeAi(),
      sessionMessages: vi.fn(async (_id: string, q?: { before?: number }) =>
        q?.before === undefined ? page : oldRows.filter((r) => r.seq < q.before!),
      ),
    };
    const port = createAd4mAgentConversations({ ai } as never);
    const seen: string[][] = [];
    port.follow({ id: 's1' }, (messages) => seen.push(messages.map((m) => m.text ?? '')));
    await vi.waitFor(() => expect(seen).toHaveLength(1));
    expect(ai.sessionMessages).toHaveBeenCalledTimes(2);
    expect(ai.sessionMessages).toHaveBeenNthCalledWith(2, 's1', { limit: 200, before: 2 });
    expect(seen[0]).toHaveLength(201);
    expect(seen[0][0]).toBe('first');
    expect(seen[0][200]).toBe('m201');
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

  it('flags a reply the boundary refused outright — a refused step is not the reply failing', async () => {
    const refused = conversationOf([
      row({ role: 'assistant', status: 'failed', error: 'Capability is not matched: agent', seq: 1 }),
    ]);
    expect(refused[0].refused).toBe(true);
    const recovered = conversationOf([
      row({ role: 'assistant', content: text('answered anyway'), status: 'done', seq: 1 }),
      row({
        role: 'tool',
        content: tool('agent_who_am_i'),
        status: 'failed',
        error: 'Capability is not matched: agent',
        seq: 2,
      }),
    ]);
    expect(recovered[0].refused).toBeUndefined();
    expect(recovered[0].steps?.[0].refused).toBe(true);
  });

  it('says nothing for events that land before the first read — then says the whole transcript', async () => {
    let handler: ((event: unknown) => void) | undefined;
    const ai = {
      ...fakeAi(),
      sessionMessages: vi.fn(async () => [
        row({ id: 'm1', role: 'user', content: text('q'), seq: 1 }),
        row({ id: 'm2', role: 'assistant', content: text('done'), status: 'done', seq: 2 }),
      ]),
      onSessionChanged: vi.fn((h: (e: unknown) => void) => {
        handler = h;
        return () => {};
      }),
    };
    const port = createAd4mAgentConversations({ ai } as never);
    const pushes: string[][] = [];
    port.follow({ id: 's1' }, (messages) => pushes.push(messages.map((m) => m.id)));

    // An event racing the read used to emit its lone row as if that were the conversation.
    handler!({
      sessionId: 's1',
      kind: 'message',
      session: null,
      message: row({ id: 'm3', role: 'user', content: text('late'), seq: 3 }),
    });
    expect(pushes).toEqual([]);
    await vi.waitFor(() => expect(pushes.length).toBe(1));
    expect(pushes[0]).toEqual(['m1', 'm2', 'm3']);
  });

  it('answers a deleted event with an empty transcript, once, and listens no more', async () => {
    let handler: ((event: unknown) => void) | undefined;
    const ai = {
      ...fakeAi(),
      sessionMessages: vi.fn(async () => [row({ id: 'm1', role: 'user', content: text('q'), seq: 1 })]),
      onSessionChanged: vi.fn((h: (e: unknown) => void) => {
        handler = h;
        return () => {};
      }),
    };
    const port = createAd4mAgentConversations({ ai } as never);
    const pushes: number[] = [];
    port.follow({ id: 's1' }, (messages) => pushes.push(messages.length));
    await vi.waitFor(() => expect(pushes).toEqual([1]));

    handler!({ sessionId: 's1', kind: 'deleted', session: null, message: null });
    expect(pushes).toEqual([1, 0]);
    handler!({
      sessionId: 's1',
      kind: 'message',
      session: null,
      message: row({ role: 'user', content: text('x'), seq: 9 }),
    });
    expect(pushes).toEqual([1, 0]);
  });

  it('keeps asking while a reply runs — a settle the socket missed lands on the next read', async () => {
    vi.useFakeTimers();
    try {
      const ai = {
        ...fakeAi(),
        // The read fails as long as the socket pretends to be down, then answers the settled row.
        sessionMessages: vi
          .fn()
          .mockImplementationOnce(async () => [
            row({ id: 'm1', role: 'user', content: text('q'), seq: 1 }),
            row({ id: 'm2', role: 'assistant', content: text(''), status: 'running', seq: 2 }),
          ])
          .mockRejectedValueOnce(new Error('socket down'))
          .mockImplementation(async () => [
            row({ id: 'm1', role: 'user', content: text('q'), seq: 1 }),
            row({ id: 'm2', role: 'assistant', content: text('done!'), status: 'done', seq: 2 }),
          ]),
      };
      const port = createAd4mAgentConversations({ ai } as never);
      const pushes: (string | undefined)[][] = [];
      port.follow({ id: 's1' }, (messages) => pushes.push(messages.map((m) => m.status)));

      await vi.advanceTimersByTimeAsync(0);
      expect(pushes).toEqual([[undefined, 'running']]);
      vi.spyOn(console, 'warn').mockImplementation(() => {});

      // While it still says running, the transcript is read again — the missed settle arrives
      // on the read after the failed one, not on an event that never came.
      await vi.advanceTimersByTimeAsync(3000);
      expect(ai.sessionMessages).toHaveBeenCalledTimes(2);
      expect(pushes).toEqual([[undefined, 'running']]);
      await vi.advanceTimersByTimeAsync(3000);
      expect(pushes.at(-1)).toEqual([undefined, 'done']);
      const callsAtDone = ai.sessionMessages.mock.calls.length;

      // Nothing left running: the poll is done too.
      await vi.advanceTimersByTimeAsync(6000);
      expect(ai.sessionMessages).toHaveBeenCalledTimes(callsAtDone);
    } finally {
      vi.useRealTimers();
    }
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
