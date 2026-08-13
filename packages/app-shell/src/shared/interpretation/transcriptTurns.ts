/**
 * Reading a collection's children back as a transcript.
 *
 * This is the host's job rather than the module's, and that is a consequence of the module contract
 * rather than a preference: `createEntity` and `linkEntity` are its entire data surface, with no read
 * at all. So a module can write utterances into a call and cannot read them out — which is exactly
 * what interpreting them needs. Rather than widen the contract with a general query (a much larger
 * decision, and one that wants an answer for reactivity and permissions first), the host gathers the
 * turns and the module asks for a collection by id.
 *
 * That split is also the honest one. Only the host knows how a WE collection is laid out; a module
 * that assembled turns itself would be hard-coding `we://children` and the block vocabulary, which
 * is precisely the backend knowledge modules are kept away from.
 *
 * Every agent transcribes only their own microphone, so a child's author *is* its speaker and no
 * diarization is involved. That is a property of how transcription was built, and it is what makes
 * speaker attribution here free and correct rather than inferred.
 */
import type { ModelManifestEntry, TranscriptTurn } from '@we/backend-shared';

/** The model statics this needs, narrowed so callers can pass an ORM class without a cast. */
export interface TurnModel {
  findAll(handle: unknown, options: Record<string, unknown>): Promise<Record<string, unknown>[]>;
}

export interface GatherTurnsDeps {
  /** Resolve an entity name to its model class for the dataset being read. */
  modelFor(entity: string): TurnModel | undefined;
  /** The dataset handle the models take. */
  handle: unknown;
  /** The dataset's schema, used to find the containment predicate rather than assuming it. */
  manifest: ModelManifestEntry[];
}

/** Entities whose instances can be a turn. Only TextBlock today; a list so a caller can widen it. */
const DEFAULT_TURN_ENTITIES = ['TextBlock'];

/** The container entity and the relation holding its children. */
const CONTAINER = 'CollectionBlock';
const CHILDREN = 'children';

/**
 * Normalise whatever the model layer hands back for `createdAt` into ISO-8601.
 *
 * The ORM parses ISO timestamps to epoch milliseconds on read, so this receives a number far more
 * often than a string — but not always, and a turn with a malformed timestamp is worse than no turn:
 * the timestamp is what makes a turn identifiable to a processed-turn cursor, so a bad one can make
 * the same sentence look new forever.
 */
function isoTimestamp(value: unknown): string | null {
  if (typeof value === 'number' && Number.isFinite(value)) return new Date(value).toISOString();
  if (typeof value === 'string' && value) {
    const parsed = new Date(value);
    if (!Number.isNaN(parsed.getTime())) return parsed.toISOString();
  }
  return null;
}

/**
 * Gather a collection's children as ordered transcript turns.
 *
 * Ordered by timestamp here rather than left to the caller, because the order turns are read in is
 * an artefact of storage and the order they were *said* in is the only one an LLM can reason about.
 * Turns with no text, no author or no usable timestamp are dropped — each of those makes a turn
 * either meaningless or unidentifiable, and passing them on spends tokens to confuse the model.
 */
export async function gatherTranscriptTurns(
  deps: GatherTurnsDeps,
  collectionId: string,
  options: { entities?: string[]; limit?: number } = {},
): Promise<TranscriptTurn[]> {
  const predicate = deps.manifest
    .find((entry) => entry.name === CONTAINER)
    ?.properties.find((property) => property.name === CHILDREN)?.predicate;
  // No containment predicate means this dataset has no WE collection schema installed, which is a
  // real state (a foreign space) rather than a bug — there is simply nothing to gather.
  if (!predicate) return [];

  const turns: TranscriptTurn[] = [];

  for (const entity of options.entities ?? DEFAULT_TURN_ENTITIES) {
    const model = deps.modelFor(entity);
    if (!model) continue;

    const rows = await model.findAll(deps.handle, {
      parent: { id: collectionId, predicate },
      ...(options.limit !== undefined ? { limit: options.limit } : {}),
    });

    for (const row of rows) {
      const text = typeof row.text === 'string' ? row.text.trim() : '';
      const speaker = typeof row.author === 'string' ? row.author : '';
      const timestamp = isoTimestamp(row.createdAt);
      if (!text || !speaker || !timestamp) continue;
      turns.push({ speaker, text, timestamp });
    }
  }

  return turns.sort((a, b) => a.timestamp.localeCompare(b.timestamp));
}
