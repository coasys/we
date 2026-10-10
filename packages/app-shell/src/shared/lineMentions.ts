/**
 * A message's mentions, kept in step with its marks wherever it is written from.
 *
 * ## Two places, one rule
 *
 * A mention is stored twice: a mark over "@Ann" for drawing, and a `we://mention` link for asking
 * "who is mentioned where". A composition — a post — has both written by the block system's save
 * (`writeMentions`). A line — a transcript utterance, a message in the Feed — is one `TextBlock`
 * written by a module, and a module cannot see marks: they are the block system's, and opaque to it
 * by design. So the host keeps the link in step as the line passes through it, at the one place every
 * module write does.
 *
 * ## An edit made as plain text
 *
 * A correction typed into a field that knows nothing of marks keeps only the marks still over the
 * same words (`rebaseMarks`), and the links follow: mend a line and leave "@Ann" alone, and Ann is
 * still mentioned; edit her name away, and she is not.
 */
import { mentionChanges, mentionedDids, parseMarks, rebaseMarks, serializeMarks } from '@we/block-shared';
import { CORE_MANIFEST } from '@we/entities/manifest';

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

/** After a create: link everybody the new line's marks mention. */
export async function linkNewMentions(
  Model: MentionWriter,
  dataset: unknown,
  entity: string,
  id: string,
  fields: Record<string, unknown>,
): Promise<void> {
  if (!id || !carriesMentions(entity)) return;
  for (const did of mentionedDids(parseMarks(fields.marks))) {
    await Model.addRelation(dataset, id, 'mentions', did);
  }
}

/**
 * Before an update that changes the words: carry the marks over (unless the update names its own),
 * and afterwards move the links to match. Answers the fields to write and a step to run once they are
 * written; the fields unchanged and no step when the update is not about a line's words.
 */
export async function prepareMentionUpdate(
  Model: MentionWriter,
  dataset: unknown,
  entity: string,
  id: string,
  fields: Record<string, unknown>,
): Promise<{ fields: Record<string, unknown>; after: () => Promise<void> }> {
  const nothing = { fields, after: async () => {} };
  if (!carriesMentions(entity) || (!('text' in fields) && !('marks' in fields)) || !Model.findOne) return nothing;
  const current = await Model.findOne(dataset, { where: { id } }).catch(() => null);
  if (!current) return nothing;

  const before = parseMarks(current.marks);
  const marks =
    'marks' in fields
      ? parseMarks(fields.marks)
      : rebaseMarks(String(current.text ?? ''), String(fields.text ?? ''), before);
  const next =
    'marks' in fields || marks.length !== before.length ? { ...fields, marks: serializeMarks(marks) } : fields;

  const linked = Array.isArray(current.mentions) ? (current.mentions as unknown[]).map(String) : [];
  const { add, remove } = mentionChanges(linked, mentionedDids(marks));
  return {
    fields: next,
    after: async () => {
      for (const did of add) await Model.addRelation(dataset, id, 'mentions', did);
      for (const did of remove) await Model.removeRelation(dataset, id, 'mentions', did);
    },
  };
}
