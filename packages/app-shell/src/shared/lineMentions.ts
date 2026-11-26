/**
 * A message's mentions, kept in step with its marks wherever it is written from.
 *
 * ## Two places, one rule
 *
 * A mention is stored twice: a mark over "@Ann" for drawing, and a `we://mention` link for asking
 * "who is mentioned where". The link is on the root of what was said. A composition — a post — has
 * both written by the block system's save (`writeMentions`). A line — a transcript utterance — is one
 * `TextBlock` a module writes through the host, so the host keeps the link in step as the line passes
 * through it, at the one place every module write does.
 *
 * ## A line inside a message
 *
 * A typed message is a composition too (see `composition.ts` in `@we/messages`): a `CollectionBlock`
 * of a message kind, holding the `TextBlock` with the words and marks. Its root is the message, so
 * that is where its mention links are: where "who is mentioned" is asked, and where a woken agent
 * finds the files sent with it, two containment levels below. Its writer links them from the message
 * as it sends it, so a line written into a message links nothing of its own; when the line's words
 * change, the links move on the message.
 *
 * ## An edit made as plain text
 *
 * A correction typed into a field that knows nothing of marks keeps only the marks still over the
 * same words (`rebaseMarks`), and the links follow: mend a line and leave "@Ann" alone, and Ann is
 * still mentioned; edit her name away, and she is not.
 */
import { mentionChanges, mentionedDids, parseMarks, rebaseMarks, serializeMarks } from '@we/block-shared';
import { CORE_MANIFEST } from '@we/entities/manifest';

import { MESSAGE_KINDS } from './interpretation/transcriptTurns';

/** A line's text field, which is a string wherever it is set. */
const textOf = (value: unknown): string => (typeof value === 'string' ? value : '');

const idOf = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return idOf(value[0]);
  return (value as { id?: unknown } | undefined)?.id ? String((value as { id: unknown }).id) : '';
};

/** The relation-write half of an entity class, as every backend's offers it. */
export interface MentionWriter {
  addRelation(dataset: unknown, id: string, relation: string, targetId: string): Promise<void>;
  removeRelation(dataset: unknown, id: string, relation: string, targetId: string): Promise<void>;
  findOne?(dataset: unknown, query: Record<string, unknown>): Promise<Record<string, unknown> | null>;
}

/** Whether a record of this entity is a message whose marks can mention somebody. */
export function carriesMentions(entity: string): boolean {
  const schema = CORE_MANIFEST.entities[entity];
  return Boolean(schema?.properties.marks && schema.relations.mentions);
}

/** The message composition with this id, read through `Messages` (`CollectionBlock`), or null. */
async function messageAt(
  Messages: MentionWriter | undefined,
  dataset: unknown,
  id: string,
): Promise<Record<string, unknown> | null> {
  if (!id || !Messages?.findOne) return null;
  const row = await Messages.findOne(dataset, { where: { id } }).catch(() => null);
  return row && MESSAGE_KINDS.includes(row.kind as string) ? row : null;
}

/**
 * After a create: link everybody the new line's marks mention — unless it was written into a message
 * (`parent`, read through `Messages`), whose writer links them from the message.
 */
export async function linkNewMentions(
  Model: MentionWriter,
  dataset: unknown,
  entity: string,
  id: string,
  fields: Record<string, unknown>,
  parent?: unknown,
  Messages?: MentionWriter,
): Promise<void> {
  if (!id || !carriesMentions(entity)) return;
  const dids = mentionedDids(parseMarks(fields.marks));
  if (!dids.length) return;
  const into = parent as { id?: unknown; relation?: unknown } | undefined;
  if (into?.relation === 'children' && (await messageAt(Messages, dataset, idOf(into)))) return;
  for (const did of dids) {
    await Model.addRelation(dataset, id, 'mentions', did);
  }
}

/**
 * Before an update that changes the words: carry the marks over (unless the update names its own),
 * and afterwards move the links to match — on the line, or on the message that holds it (`partOf`,
 * read through `Messages`). Answers the fields to write and a step to run once they are written; the
 * fields unchanged and no step when the update is not about a line's words.
 */
export async function prepareMentionUpdate(
  Model: MentionWriter,
  dataset: unknown,
  entity: string,
  id: string,
  fields: Record<string, unknown>,
  Messages?: MentionWriter,
): Promise<{ fields: Record<string, unknown>; after: () => Promise<void> }> {
  const nothing = { fields, after: async () => {} };
  if (!carriesMentions(entity) || (!('text' in fields) && !('marks' in fields)) || !Model.findOne) return nothing;
  const current = await Model.findOne(dataset, { where: { id } }).catch(() => null);
  if (!current) return nothing;

  const before = parseMarks(current.marks);
  const marks =
    'marks' in fields ? parseMarks(fields.marks) : rebaseMarks(textOf(current.text), textOf(fields.text), before);
  const next =
    'marks' in fields || marks.length !== before.length ? { ...fields, marks: serializeMarks(marks) } : fields;

  const message = await messageAt(Messages, dataset, idOf(current.partOf));
  const [Owner, ownerId, owner] = message && Messages ? [Messages, idOf(message), message] : [Model, id, current];
  const linked = Array.isArray(owner.mentions) ? (owner.mentions as unknown[]).map(String) : [];
  const { add, remove } = mentionChanges(linked, mentionedDids(marks));
  return {
    fields: next,
    after: async () => {
      for (const did of add) await Owner.addRelation(dataset, ownerId, 'mentions', did);
      for (const did of remove) await Owner.removeRelation(dataset, ownerId, 'mentions', did);
    },
  };
}
