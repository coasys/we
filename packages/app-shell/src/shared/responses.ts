/**
 * What a response needs beyond the link that makes it one.
 *
 * A record becomes a response by being written with `parent: { id: subject, predicate:
 * PREDICATES.RESPONSE }` — the subject's `responses` holds it, and its own `respondsTo` reads it back.
 * Two more facts follow from that, and nothing a writer passes says either, so the host works them
 * out once, here, for every path that writes a response:
 *
 * 1. **Which thread it is in.** The thread's subject is the first thing above the response that is
 *    not itself a response — the subject's own subject when it is one, else the subject. That node
 *    links to the response through `thread`, so the whole discussion under it is one read.
 * 2. **Where it lives.** A response lives in the same feed as the thing it responds to: walk up from
 *    the thread's subject, through the collections it is part of, to the nearest feed — a document
 *    is skipped, because its parts belong to its author. The response becomes a child of that feed,
 *    so a reply said in a call is in the call's transcript, its extraction and its unread count, and
 *    a comment on a post is in the post's channel.
 *
 * See `docs/architecture/relations.md` for the rule written out, and `WE_NODE_RELATIONS` for the
 * links.
 *
 * Best effort, deliberately: the response itself is written by the time this runs, and a failure
 * to file it leaves an ordinary response that every thread surface still draws. Logged, never
 * thrown into the press that wrote it.
 */
import { CollectionBlock, type DatasetProxy, getEntityForDataset, PREDICATES } from '@we/entities';
import { CORE_MANIFEST } from '@we/entities/manifest';

/** How far up the containment a walk for a feed goes before giving up — collections nest shallowly. */
const MOST_LEVELS = 8;

/** The `kind` of the space collection, which is a feed whatever its `mode` says: spaces made before it was written carry none. */
const SPACE_KIND = 'space';

type NodeRow = { id: string; inThread?: unknown; partOf?: unknown; mode?: unknown; kind?: unknown };

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

/** The nearest feed above a node — the collection a response to its thread lives in — or empty. */
async function feedAbove(dataset: DatasetProxy, node: NodeRow): Promise<string> {
  let parentId = idOf(node.partOf);
  for (let level = 0; parentId && level < MOST_LEVELS; level++) {
    const parent = (await CollectionBlock.findOne(dataset, { where: { id: parentId } })) as unknown as NodeRow | null;
    if (!parent) return '';
    if (parent.mode === 'feed' || parent.kind === SPACE_KIND) return parent.id;
    parentId = idOf(parent.partOf);
  }
  return '';
}

/**
 * File a response that has just been written: link it into its thread, and into the feed it lives
 * in. `subjectEntity` is a hint, for a caller that knows what it answered.
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

    const home = await feedAbove(dataset, root.row);
    if (home) await CollectionBlock.addRelation(dataset, home, 'children', responseId);
  } catch (error) {
    console.warn('responses: could not file a response in its thread and its feed', error);
  }
}

/** Whether a write's `parent` option makes the record a response. */
export function respondsThrough(options: unknown): string {
  const parent = (options as { parent?: { id?: unknown; predicate?: unknown } } | undefined)?.parent;
  return parent?.predicate === PREDICATES.RESPONSE && typeof parent.id === 'string' ? parent.id : '';
}
