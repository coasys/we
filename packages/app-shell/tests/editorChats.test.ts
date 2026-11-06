/**
 * The editor's chats as WE's ordinary records, against the in-memory backend: a chat is a
 * `CollectionBlock` of kind `chat`, its messages `TextBlock`s, and a reply is marked as a model's.
 */
import { createInMemoryBackendPorts } from '@we/backend-inmemory';
import { registerCoreBlocks } from '@we/block-shared';
import { type DatasetProxy, getEntity } from '@we/entities';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';

import { appendMessage, chatMessages, chatsAbout, clearChat, deleteChat, startChat } from '../src/shared/editorChats';

type Row = Record<string, unknown> & { id: string };
const all = (entity: string, where: Record<string, unknown> = {}) =>
  (getEntity(entity) as unknown as { findAll(d: unknown, q?: unknown): Promise<Row[]> }).findAll(root, { where });

let root: DatasetProxy;

beforeAll(() => registerCoreBlocks());

beforeEach(async () => {
  const ports = createInMemoryBackendPorts(
    { selfId: () => 'did:test:me' },
    { agent: { id: 'did:test:me', unlocked: true }, datasets: [{ id: 'root', name: 'we-root' }] },
  );
  root = (await ports.lifecycle.get('root'))!.handle as DatasetProxy;
});

describe("the editor's chats", () => {
  it('keeps a conversation in order, and tells the model’s replies from the person’s', async () => {
    const chat = await startChat(root, 'my-template', 'Chat 1');
    await appendMessage(root, chat.id, { role: 'user', content: 'Make the header blue' });
    await appendMessage(root, chat.id, { role: 'assistant', content: 'Done.', model: 'claude-test' });
    await appendMessage(root, chat.id, { role: 'user', content: 'Thanks' });

    const messages = await chatMessages(root, chat.id);
    expect(messages.map((m) => [m.role, m.content])).toEqual([
      ['user', 'Make the header blue'],
      ['assistant', 'Done.'],
      ['user', 'Thanks'],
    ]);
  });

  it('marks a reply with a chat run hung off the chat, and the person’s words with nothing', async () => {
    const chat = await startChat(root, 'my-template', 'Chat 1');
    await appendMessage(root, chat.id, { role: 'user', content: 'Hello' });
    await appendMessage(root, chat.id, { role: 'assistant', content: 'Hi', model: 'claude-test' });

    const runs = await all('ModelRun');
    expect(runs).toHaveLength(1);
    expect(runs[0]).toMatchObject({ kind: 'chat', model: 'claude-test', outcome: 'done' });

    const blocks = await all('TextBlock');
    const reply = blocks.find((b) => b.text === 'Hi')!;
    const said = blocks.find((b) => b.text === 'Hello')!;
    expect(reply.generatedBy).toBe(runs[0].id);
    expect(said.generatedBy ?? '').toBe('');

    const [stored] = await all('CollectionBlock', { id: chat.id });
    expect(stored).toMatchObject({ kind: 'chat', mode: 'feed', slug: 'my-template' });
  });

  it('lists one template’s chats, newest first, with the newest one’s messages', async () => {
    const first = await startChat(root, 'my-template', 'Chat 1');
    await appendMessage(root, first.id, { role: 'user', content: 'old' });
    await startChat(root, 'another-template', 'Elsewhere');
    await new Promise((resolve) => setTimeout(resolve, 5));
    const second = await startChat(root, 'my-template', 'Chat 2');
    await appendMessage(root, second.id, { role: 'user', content: 'new' });

    const { chats, latest } = await chatsAbout(root, 'my-template');
    expect(chats.map((c) => c.name)).toEqual(['Chat 2', 'Chat 1']);
    expect(latest.map((m) => m.content)).toEqual(['new']);
  });

  it('clears a chat’s messages and runs, and deletes a chat with everything in it', async () => {
    const kept = await startChat(root, 'my-template', 'Kept');
    await appendMessage(root, kept.id, { role: 'user', content: 'stays' });
    const chat = await startChat(root, 'my-template', 'Chat 1');
    await appendMessage(root, chat.id, { role: 'user', content: 'Hello' });
    await appendMessage(root, chat.id, { role: 'assistant', content: 'Hi' });

    await clearChat(root, chat.id);
    expect(await chatMessages(root, chat.id)).toEqual([]);
    expect(await all('ModelRun')).toHaveLength(0);
    expect((await all('CollectionBlock', { id: chat.id })).length).toBe(1);

    await appendMessage(root, chat.id, { role: 'assistant', content: 'Again' });
    await deleteChat(root, chat.id);
    expect(await all('CollectionBlock', { id: chat.id })).toEqual([]);
    expect((await all('TextBlock')).map((b) => b.text)).toEqual(['stays']);
    expect(await all('ModelRun')).toHaveLength(0);
  });
});
