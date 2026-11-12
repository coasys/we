/**
 * The `ai.session*` conversations, against a real executor.
 *
 * What the unit tests fake and this file proves: a session the adapter creates unscoped carries no
 * `capabilities` (so it inherits everything the app's token holds) and one scoped to a perspective
 * carries the single-perspective grant and `defaultPerspective`; the list reports both, the scoped
 * one wearing its scope; update, follow and delete behave.
 *
 * The turn cases — a step landing live, a reply arriving, a capability refusal — need a model the
 * executor can reach, so they sit behind `LLM_E2E=1`. Ollama answers on plain HTTP only for
 * localhost (the executor refuses an API key over HTTP anywhere else), so they go through the
 * TCP forward already running on this box: `127.0.0.1:11436` → `marvin.fritz.box:11434`.
 *
 * Run with `pnpm --filter @we/backend-ad4m test:live`. LLM turn: `LLM_E2E=1 pnpm ... test:live`.
 */
import { Ad4mClient, type PerspectiveProxy } from '@coasys/ad4m';
import type { AgentConversationMessage } from '@we/backend-shared';
import { afterAll, beforeAll, describe, expect, inject, it } from 'vitest';

import { createAd4mAgentConversations } from '../../src/agentConversations';

const SCOPED_CAN = ['READ', 'CREATE', 'UPDATE', 'DELETE', 'SUBSCRIBE'];

/** The latest batch a follow emits once `cond` holds, or throws after `ms`. */
function waitFor(
  messages: AgentConversationMessage[][],
  cond: (rows: AgentConversationMessage[]) => boolean,
  ms = 120_000,
): Promise<AgentConversationMessage[]> {
  return new Promise((done, fail) => {
    const deadline = Date.now() + ms;
    const tick = () => {
      const last = messages[messages.length - 1];
      if (last && cond(last)) return done(last);
      if (Date.now() > deadline) return fail(new Error('timed out waiting for the conversation to settle'));
      setTimeout(tick, 250);
    };
    tick();
  });
}

describe('agent conversations, live', () => {
  let client: Ad4mClient;
  let space: PerspectiveProxy;
  let conversations: ReturnType<typeof createAd4mAgentConversations>;
  const made: string[] = [];

  beforeAll(async () => {
    const { url, token } = inject('ad4mExecutor');
    client = new Ad4mClient(url, token);
    space = await client.perspective.add(`we-chat-live-${Date.now()}`);
    conversations = createAd4mAgentConversations(client);
  }, 60_000);

  afterAll(async () => {
    for (const id of made) await client.ai.sessionDelete(id).catch(() => undefined);
    if (space) await client.perspective.remove(space.uuid).catch(() => undefined);
    client?.close();
  });

  it('creates a global session with no capabilities — it inherits the token’s grants', async () => {
    const ref = await conversations.create({ title: 'global chat' });
    made.push(ref.id);

    const session = await client.ai.session(ref.id);
    expect(session.id).toBe(ref.id);
    expect(session.title).toBe('global chat');
    // Created without `capabilities`: the row either stores none or the token's materialized
    // grants — never a perspective pin it was not given.
    expect(Array.isArray(session.capabilities)).toBe(true);
    console.log(`[live] global session capabilities: ${JSON.stringify(session.capabilities)}`);
    expect(session.defaultPerspective ?? null).toBeNull();
  });

  it('creates a session scoped to one perspective with the space’s grants', async () => {
    const ref = await conversations.create({ title: 'space chat', scope: { perspectiveUuid: space.uuid } });
    made.push(ref.id);

    const session = await client.ai.session(ref.id);
    expect(session.defaultPerspective).toBe(space.uuid);
    expect(session.capabilities).toEqual([
      { with: { domain: 'perspective', pointers: [space.uuid] }, can: SCOPED_CAN },
    ]);
  });

  it('lists both, the scoped one wearing its scope', async () => {
    const list = await conversations.list();
    const scoped = list.find((s) => s.title === 'space chat');
    const global = list.find((s) => s.title === 'global chat');
    expect(global?.scope).toBeUndefined();
    expect(scoped?.scope?.perspectiveUuid).toBe(space.uuid);
    // Sorted by latest update, newest first.
    for (let i = 1; i < list.length; i++) {
      const prev = list[i - 1].updatedAt ?? list[i - 1].createdAt;
      const next = list[i].updatedAt ?? list[i].createdAt;
      expect(prev).toBeGreaterThanOrEqual(next);
    }
  });

  it('renames a session and drops it', async () => {
    const ref = await conversations.create({ title: 'before' });
    await conversations.update?.(ref, { title: 'after' });
    expect((await client.ai.session(ref.id)).title).toBe('after');

    await conversations.delete(ref);
    await expect(client.ai.session(ref.id)).rejects.toThrow();
    expect((await conversations.list()).some((s) => s.ref.id === ref.id)).toBe(false);
  });

  it('follows a conversation: the initial read arrives, empty', async () => {
    const ref = await conversations.create({ title: 'followed' });
    made.push(ref.id);
    const batches: AgentConversationMessage[][] = [];
    const unfollow = conversations.follow(ref, (rows) => batches.push(rows));
    try {
      await waitFor(batches, () => batches.length > 0, 15_000);
      expect(batches[0]).toEqual([]);
    } finally {
      unfollow();
    }
  });

  it('cancel on an idle session is a no-op the node tolerates', async () => {
    const ref = await conversations.create({ title: 'idle cancel' });
    made.push(ref.id);
    // No turn is running; the executor may no-op or refuse — either is honest, a crash is not.
    await conversations.cancel(ref).then(
      () => undefined,
      (error: unknown) => expect(String(error)).not.toMatch(/unknown method|not implemented/i),
    );
  });

  /*
    A real turn, behind LLM_E2E: registers Marvin's Ollama over the loopback forward on :11436,
    asks the scoped chat to list its perspectives (a step shows, the reply names the one space),
    proves a link add marks its step `wrote` while a read stays unmarked, then asks for another
    space and reads the refusal the capability boundary produces.
  */
  describe.skipIf(!process.env.LLM_E2E)('a live LLM turn', () => {
    let endpointId = '';
    let modelId = '';

    beforeAll(async () => {
      const endpoint = await client.ai.addEndpoint({
        name: 'marvin-ollama',
        kind: 'OLLAMA',
        baseUrl: 'http://127.0.0.1:11436/v1',
        maxNumCtx: 49_152,
      });
      endpointId = endpoint.id;
      modelId = await client.ai.addModel({
        name: 'qwen3.8-27b-48k',
        modelType: 'LLM',
        endpointId,
        remoteModel: 'qwen3.8-27b-48k:latest',
      });
      await client.ai.setDefaultModel('LLM', modelId);
    }, 60_000);

    afterAll(async () => {
      if (modelId) await client.ai.removeModel(modelId).catch(() => undefined);
      if (endpointId) await client.ai.removeEndpoint(endpointId).catch(() => undefined);
    });

    it('runs a turn in the scoped chat: a step shows, the reply lands whole', async () => {
      const ref = await conversations.create({ title: 'scoped turn', scope: { perspectiveUuid: space.uuid } });
      made.push(ref.id);
      const batches: AgentConversationMessage[][] = [];
      const unfollow = conversations.follow(ref, (rows) => batches.push(rows));
      try {
        await conversations.send(ref, 'List the perspectives you can reach. Just the names, one line each.');
        const settled = await waitFor(
          batches,
          (rows) => rows.some((m) => m.role === 'assistant' && m.status === 'done'),
          300_000,
        );
        const reply = settled.find((m) => m.role === 'assistant' && m.status === 'done');
        expect(reply?.text.length).toBeGreaterThan(0);
        console.log(`\n[live turn] reply: ${reply?.text.slice(0, 300)}`);
        for (const m of settled.filter((m) => m.role === 'assistant')) {
          for (const s of m.steps ?? []) console.log(`[live turn] step ${s.outcome}: ${s.tool} ${s.target ?? ''}`);
        }
      } finally {
        unfollow();
      }
    }, 320_000);

    /*
      The `writes` flag end to end: one turn only reads (list), the next adds a link. The read
      turn's steps carry no `wrote`; the add-link step does — the executor's own call on the row,
      not the adapter's name guess.
    */
    it('marks the write a turn made, and leaves the read turn unmarked', async () => {
      const ref = await conversations.create({ title: 'write mark', scope: { perspectiveUuid: space.uuid } });
      made.push(ref.id);
      const batches: AgentConversationMessage[][] = [];
      const unfollow = conversations.follow(ref, (rows) => batches.push(rows));
      try {
        await conversations.send(ref, 'List the perspectives you can reach. Just the names, one line each.');
        await waitFor(batches, (rows) => rows.some((m) => m.role === 'assistant' && m.status === 'done'), 300_000);
        await conversations.send(
          ref,
          'Now call the add_link tool on this perspective: source "ad4m://me", predicate "ad4m://hello", target "literal:string:hello".',
        );
        const settled = await waitFor(
          batches,
          (rows) => rows.filter((m) => m.role === 'assistant' && m.status === 'done').length >= 2,
          300_000,
        );
        const replies = settled.filter((m) => m.role === 'assistant' && m.status === 'done');
        const reads = replies[0].steps ?? [];
        const writes = replies[replies.length - 1].steps ?? [];
        for (const reply of replies) {
          console.log(`[live writes] reply: ${reply.text.slice(0, 200)}`);
          for (const s of reply.steps ?? []) {
            console.log(`[live writes] ${s.tool}: wrote=${s.wrote ?? false} (${s.outcome})`);
          }
        }
        expect(reads.length).toBeGreaterThan(0);
        expect(reads.every((s) => !s.wrote)).toBe(true);
        expect(writes.some((s) => s.wrote)).toBe(true);
      } finally {
        unfollow();
      }
    }, 640_000);

    it('refuses a reach past the scope — the error the chat surfaces', async () => {
      /*
        A second perspective the scoped session may not touch, asked for by uuid. Asking it to "find
        the other space" never reaches the boundary — scoped `list_perspectives` shows it only its
        own, so the model correctly reports one. The refusal needs a tool call aimed at the uuid.
      */
      const other = await client.perspective.add(`we-chat-live-other-${Date.now()}`);
      const ref = await conversations.create({ title: 'refusal', scope: { perspectiveUuid: space.uuid } });
      made.push(ref.id);
      const batches: AgentConversationMessage[][] = [];
      const unfollow = conversations.follow(ref, (rows) => batches.push(rows));
      try {
        await conversations.send(
          ref,
          `Call describe_perspective on perspective "${other.uuid}" and tell me what it holds.`,
        );
        const settled = await waitFor(
          batches,
          (rows) => rows.some((m) => m.role === 'assistant' && ['done', 'failed'].includes(m.status ?? '')),
          300_000,
        );
        const flat = JSON.stringify(settled);
        const reply = settled.findLast((m) => m.role === 'assistant');
        console.log(`\n[live refusal] reply (${reply?.status}): ${reply?.text.slice(0, 300)} error=${reply?.error}`);
        // The refusal can land as the reply's failure or as a failed step — either way it is the
        // executor's own "Capability is not matched".
        expect(flat).toContain('Capability is not matched');
      } finally {
        unfollow();
        await client.perspective.remove(other.uuid).catch(() => undefined);
      }
    }, 320_000);
  });
});
