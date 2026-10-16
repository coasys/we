/**
 * What a response needs beyond the link that makes it one.
 *
 * A record becomes a response by being written with `parent: { id: subject, relation: 'responses' }`
 * — the subject's `responses` holds it, and its own `respondsTo` reads it back.
 * One more fact follows from that, and nothing a writer passes says it, so the host works it out
 * once, here, for every path that writes a response:
 *
 * **Which thread it is in.** The thread's subject is the first thing above the response that is not
 * itself a response — the subject's own subject when it is one, else the subject. That node links to
 * the response through `thread`, so the whole discussion under it is one read.
 *
 * A response is never a child of anything. Where it was said is derived, not stored: its thread's
 * subject, and wherever that subject is a child. So a reply to a line in a call is read with the
 * call's lines, and a comment on a post with the post — nothing is filed twice, and moving a post
 * to another channel moves its discussion with it.
 *
 * See `docs/architecture/relations.md` for the three links written out, and `WE_NODE_RELATIONS` for
 * their declarations.
 *
 * Best effort, deliberately: the response itself is written by the time this runs, and a failure to
 * thread it leaves an ordinary response that its subject's `responses` still holds. Logged, never
 * thrown into the press that wrote it.
 */
import { type DatasetProxy, getEntityForDataset } from '@we/entities';
import { CORE_MANIFEST } from '@we/entities/manifest';

type NodeRow = { id: string; inThread?: unknown };

const idOf = (value: unknown): string => {
  if (typeof value === 'string') return value;
  if (Array.isArray(value)) return idOf(value[0]);
  return (value as { id?: string } | undefined)?.id ?? '';
};

/** Entities to try for a node of unknown type, likeliest first — what responses are usually made to. */
function candidateEntities(hint?: string): string[] {
  const all = Object.entries(CORE_MANIFEST.entities)
    .filter(([, schema]) => !schema.abstract)
    .map(([name]) => name);
  const first = [hint, 'CollectionBlock', 'TextBlock', 'TaskBlock', 'EventBlock'].filter(
    (name): name is string => !!name && all.includes(name),
  );
  return [...new Set([...first, ...all])];
}

/**
 * One node and the class it is, for an id whose type the caller may not know.
 *
 * A class-scoped `findOne` answers null for a record that is not of that class, so the first answer
 * is both the classification and the row — the way the serializer resolves a block.
 */
async function readNode(
  dataset: DatasetProxy,
  id: string,
  hint?: string,
): Promise<{ row: NodeRow; entity: string } | null> {
  for (const entity of candidateEntities(hint)) {
    const Model = getEntityForDataset(entity, dataset);
    if (!Model?.findOne) continue;
    try {
      const row = (await Model.findOne(dataset, { where: { id } })) as NodeRow | null;
      if (row) return { row, entity };
    } catch {
      // A class this dataset has no shape for answers by refusing; it is simply not this one.
    }
  }
  return null;
}

/**
 * Thread a response that has just been written: link it from its thread's subject. `subjectEntity`
 * is a hint, for a caller that knows what it answered.
 */
export async function completeResponse(
  dataset: DatasetProxy,
  responseId: string,
  subjectId: string,
  subjectEntity?: string,
): Promise<void> {
  if (!dataset || !responseId || !subjectId) return;
  try {
    const subject = await readNode(dataset, subjectId, subjectEntity);
    if (!subject) return;
    const rootId = idOf(subject.row.inThread) || subjectId;
    const root = rootId === subjectId ? subject : await readNode(dataset, rootId);
    if (!root) return;

    const Root = getEntityForDataset(root.entity, dataset);
    await Root?.addRelation(dataset, rootId, 'thread', responseId);
  } catch (error) {
    console.warn('responses: could not link a response into its thread', error);
  }
}

/** Whether a write's `parent` option makes the record a response. */
export function respondsThrough(options: unknown): string {
  const parent = (options as { parent?: { id?: unknown; relation?: unknown } } | undefined)?.parent;
  return parent?.relation === 'responses' && typeof parent.id === 'string' ? parent.id : '';
}
