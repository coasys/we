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
import type { EntityManifestEntry, TranscriptTurn } from '@we/backend-shared';

/** The model statics this needs, narrowed so callers can pass an ORM class without a cast. */
export interface TurnRecord {
  findAll(handle: unknown, options: Record<string, unknown>): Promise<Record<string, unknown>[]>;
}

export interface GatherTurnsDeps {
  /** Resolve an entity name to its model class for the dataset being read. */
  modelFor(entity: string): TurnRecord | undefined;
  /** The dataset handle the models take. */
  handle: unknown;
  /**
   * The predicate holding the container's children, resolved by the caller.
   *
   * Passed in rather than looked up here, and the reason is a bug worth remembering: this used to
   * read it from the dataset's manifest, which carries **foreign** schemas only — everything WE
   * already knows natively is deliberately absent from it. So the lookup for `CollectionBlock`
   * always missed, the gather returned nothing, and extraction reported "0 records" without ever
   * reaching the model. Silent, and indistinguishable from a conversation with nothing in it.
   *
   * The caller knows whether a container is native or foreign and can answer from either.
   */
  containmentPredicate: string;
}

/** Entities whose instances can be a turn. Only TextBlock today; a list so a caller can widen it. */
const DEFAULT_TURN_ENTITIES = ['TextBlock'];

/** The shape statics this reads off a model class, narrowed so a caller passes an ORM class as-is. */
interface ShapeBearing {
  generateSHACL?: () => { shape?: { properties?: { name?: string; path?: string }[] } };
}

/**
 * The predicate holding a `CollectionBlock`'s children, from whichever side knows it.
 *
 * **The native model first, and that ordering is the whole point.** A dataset's manifest carries
 * *foreign* schemas only — everything the host knows natively is deliberately absent from it — so
 * resolving a core model's predicate from the manifest always misses. Doing exactly that made
 * extraction gather zero turns and report "0 records found" without ever reaching the model, which
 * is indistinguishable from a conversation with nothing worth extracting in it. It also left the
 * `parent` link unset, so anything that *had* been written would have been invisible in every view.
 *
 * The manifest stays as the fallback for a container that is genuinely foreign — another app's,
 * synced into the space, which the native registry has never heard of.
 */
export function containmentPredicate(
  modelFor: (entity: string) => unknown,
  manifest: EntityManifestEntry[],
  container = 'CollectionBlock',
  relation = 'children',
): string | undefined {
  const shape = (modelFor(container) as ShapeBearing | undefined)?.generateSHACL?.().shape;
  const native = shape?.properties?.find((property) => property.name === relation)?.path;
  if (native) return native;

  return manifest.find((entry) => entry.name === container)?.properties.find((property) => property.name === relation)
    ?.predicate;
}

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
  const predicate = deps.containmentPredicate;
  // No containment predicate means the caller could not resolve the collection schema — a foreign
  // space with no WE collections is a real state rather than a bug, so there is nothing to gather.
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

  /*
    Ordered by the moment each agent's own machine stamped the block, with the speaker as a
    tiebreak.

    That is not a correct ordering and cannot be made one from here: every agent transcribes their
    own microphone and stamps the block with their own clock, so two peers a few seconds apart on
    NTP produce a transcript with the replies before the questions. Fixing it properly needs a
    logical clock on the utterance, which is a change to what a `TextBlock` in a call carries and
    belongs with the content layer rather than in a sort.

    What the tiebreak *does* fix is the half that was gratuitous: equal timestamps previously came
    out in whatever order the per-entity queries returned, so two agents reading the same call could
    see a different transcript, and the prompt built from it differed between the peers running
    extraction. Same input, same order, on every machine.
  */
  return turns.sort((a, b) => a.timestamp.localeCompare(b.timestamp) || a.speaker.localeCompare(b.speaker));
}
