/**
 * The editor's own chats, stored as WE's ordinary records.
 *
 * A chat is a `CollectionBlock` of kind `chat` — a feed, since the person and the model each append
 * to it — and every message in it is a `TextBlock` among its `children`, in the order they were
 * said. A message a model wrote says so the way everything a model writes does: `generatedBy` a
 * `ModelRun` of kind `chat`, hung off the chat's `runs` (see "What a model made" in
 * `entities/CONVENTIONS.md`). So who said what is a fact about the record, not a `role` string only
 * this surface reads, and a chat is a collection every reader already understands.
 *
 * ## Which template a chat is about: its `slug`
 *
 * The template's id, as `slug` — the term a collection stands for, as a board column's is the status
 * it shows. A name rather than a `responses` link, because the two are often in different datasets:
 * a chat is the person's own and lives in their root dataset, where the template may be a space's.
 * A link has to start from a record in the dataset it is written in, so on any backend that holds to
 * that — the in-memory one does — a chat about a space's template would have nothing to hang from.
 *
 * ## Who reads these
 *
 * Only the editor. They live in the root dataset, which nothing lists collections from, so no feed or
 * board meets one; anything that ever does should filter by `kind`.
 */
import { CollectionBlock, type DatasetProxy, generatedRun, ModelRun, TextBlock } from '@we/entities';

export const CHAT_KIND = 'chat';

/** A chat as the editor lists it. */
export interface ChatSummary {
  id: string;
  name: string;
}

/** A message as the editor shows it: the person's, or the model's. */
export interface StoredChatMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt?: string;
}

type Row = Record<string, unknown> & { id: string };

const idOf = (value: unknown): string =>
  typeof value === 'string' ? value : typeof (value as { id?: unknown })?.id === 'string' ? (value as Row).id : '';

/** `createdAt` as the editor shows it: a backend answers with a string or a number. */
const timeOf = (value: unknown): string | undefined =>
  typeof value === 'string' && value ? value : typeof value === 'number' ? new Date(value).toISOString() : undefined;

const asMessage = (block: Row): StoredChatMessage => ({
  id: block.id,
  role: generatedRun(block as { generatedBy?: string }) ? 'assistant' : 'user',
  content: typeof block.text === 'string' ? block.text : '',
  createdAt: timeOf(block.createdAt),
});

/** Only the text blocks: anything else somebody hangs in a chat is not a message. */
const messagesIn = (children: unknown): StoredChatMessage[] =>
  (Array.isArray(children) ? (children as Row[]) : [])
    .filter((child) => child && typeof child === 'object' && 'text' in child)
    .map(asMessage);

/** One template's chats, newest first, with the newest one's messages so it can open at once. */
export async function chatsAbout(
  dataset: DatasetProxy,
  templateId: string,
): Promise<{ chats: ChatSummary[]; latest: StoredChatMessage[] }> {
  const rows = (await CollectionBlock.findAll(dataset, {
    where: { kind: CHAT_KIND, slug: templateId },
    order: { createdAt: 'DESC' },
  })) as unknown as Row[];
  const chats = rows.map((row) => ({ id: row.id, name: typeof row.title === 'string' ? row.title : '' }));
  return { chats, latest: chats[0] ? await chatMessages(dataset, chats[0].id) : [] };
}

/**
 * One chat's messages, in the order they were said.
 *
 * Asked for rather than read off a held record: a relation on a held instance is a snapshot of when
 * it was read, and every message written since is missing from it. `[]` for a chat that has gone.
 */
export async function chatMessages(dataset: DatasetProxy, chatId: string): Promise<StoredChatMessage[]> {
  const chat = (await CollectionBlock.findOne(dataset, {
    where: { id: chatId },
    /*
      `polymorphic` said here, not left to the declaration: `children` names no target class, and
      AD4M refuses to hydrate one asked for as `true` ("the relation declares no target class"). The
      `$query` layer adds it for a template; a model read has to say it. SpaceStore's read of a
      call's `extracted` is the same case.
    */
    include: { children: { polymorphic: true } },
  } as never)) as unknown as Row | null;
  return chat ? messagesIn(chat.children) : [];
}

/** A new, empty chat about a template. */
export async function startChat(dataset: DatasetProxy, templateId: string, name: string): Promise<ChatSummary> {
  const chat = (await CollectionBlock.create(dataset, {
    kind: CHAT_KIND,
    mode: 'feed',
    slug: templateId,
    title: name,
  })) as unknown as Row;
  return { id: chat.id, name };
}

/**
 * Add a message to a chat: the person's as it is, the model's marked with the run that wrote it.
 *
 * The run is written first so the reply can carry it in its own create — a reply is never seen
 * unmarked. `model` is the AI model's name as the backend reports it; empty where it reports none.
 */
export async function appendMessage(
  dataset: DatasetProxy,
  chatId: string,
  message: { role: 'user' | 'assistant'; content: string; model?: string },
): Promise<string> {
  const parent = { parent: { id: chatId, relation: 'children', entity: 'CollectionBlock' } };
  const fields: Record<string, unknown> = { text: message.content };
  if (message.role === 'assistant') {
    const run = (await ModelRun.create(
      dataset,
      { kind: CHAT_KIND, model: message.model ?? '', trigger: 'manual', outcome: 'done' },
      { parent: { id: chatId, relation: 'runs', entity: 'CollectionBlock' } },
    )) as unknown as Row;
    fields.generatedBy = [run.id];
  }
  const block = (await TextBlock.create(dataset, fields, parent)) as unknown as Row;
  return block.id;
}

/**
 * Empty a chat: its messages and the runs that wrote them. The chat itself stays.
 *
 * The runs go too, because a run here is about nothing but the reply it wrote — kept, it would be a
 * record of a conversation the person asked to forget.
 */
export async function clearChat(dataset: DatasetProxy, chatId: string): Promise<void> {
  // Ids only, which an un-included relation already is: nothing here needs a message's text.
  const chat = (await CollectionBlock.findOne(dataset, { where: { id: chatId } })) as unknown as Row | null;
  if (!chat) return;
  for (const child of Array.isArray(chat.children) ? (chat.children as unknown[]) : []) {
    const id = idOf(child);
    if (id) await TextBlock.delete(dataset, id);
  }
  for (const run of Array.isArray(chat.runs) ? (chat.runs as unknown[]) : []) {
    const id = idOf(run);
    if (id) await ModelRun.delete(dataset, id);
  }
}

/** Delete a chat, with everything in it. */
export async function deleteChat(dataset: DatasetProxy, chatId: string): Promise<void> {
  await clearChat(dataset, chatId);
  await CollectionBlock.delete(dataset, chatId);
}
