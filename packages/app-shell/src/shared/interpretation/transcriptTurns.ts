/**
 * Reading a collection's children, and the replies to them, back as a transcript.
 *
 * This is the host's job rather than the module's, and that is a consequence of the module contract
 * rather than a preference: `createEntity` and `linkEntity` are its entire data surface, with no read
 * at all. So a module can write utterances into a call and cannot read them out — which is exactly
 * what interpreting them needs. Rather than widen the contract with a general query (a much larger
 * decision, and one that wants an answer for reactivity and permissions first), the host gathers the
 * turns and the module asks for a collection by id.
 *
 * That split is also the honest one. Only the host knows how a WE collection is laid out; a module
 * that assembled turns itself would be hard-coding `we://child` and the block vocabulary, which
 * is precisely the backend knowledge modules are kept away from.
 *
 * Every agent transcribes only their own microphone, so a child's author *is* its speaker and no
 * diarization is involved. That is a property of how transcription was built, and it is what makes
 * speaker attribution here free and correct rather than inferred.
 */
import type { TranscriptTurn } from '@we/backend-shared';

/** The model statics this needs, narrowed so callers can pass an ORM class without a cast. */
export interface TurnRecord {
  findAll(handle: unknown, options: Record<string, unknown>): Promise<Record<string, unknown>[]>;
}

export interface GatherTurnsDeps {
  /** Resolve an entity name to its model class for the dataset being read. */
  modelFor(entity: string): TurnRecord | undefined;
  /** The dataset handle the models take. */
  handle: unknown;
}

/** Entities whose instances can be a turn. Only TextBlock today; a list so a caller can widen it. */
const DEFAULT_TURN_ENTITIES = ['TextBlock'];

/**
 * What counts as input: what a person said or wrote, by the `source` WE stamps on every message it
 * writes — said aloud, typed, or a spoken line somebody corrected.
 *
 * Everything else is left out, and that is the point rather than a side effect. A bot writing into a
 * space does not know the field, so its replies, digests and summaries arrive with none — and bot
 * output read back in as input loops: a summary that mentions three tasks is extracted into three
 * more, which paraphrase past exact-match de-duplication. People bring raw material in; a bot that
 * wants to make a record writes the record.
 */
export const INPUT_SOURCES = ['spoken', 'typed', 'corrected'] as const;

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

/** A page's rows and every member of their threads, each once — the replies said under each line. */
function withThreads(rows: Record<string, unknown>[]): Record<string, unknown>[] {
  const seen = new Set<string>();
  const out: Record<string, unknown>[] = [];
  const add = (row: unknown) => {
    if (!row || typeof row !== 'object') return;
    const record = row as Record<string, unknown>;
    const id = typeof record.id === 'string' ? record.id : '';
    if (id && seen.has(id)) return;
    if (id) seen.add(id);
    out.push(record);
  };
  for (const row of rows) {
    add(row);
    if (Array.isArray(row.thread)) for (const member of row.thread) add(member);
  }
  return out;
}

/**
 * Gather a collection's children, and the replies in their threads, as ordered transcript turns.
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
  const turns: TranscriptTurn[] = [];

  for (const entity of options.entities ?? DEFAULT_TURN_ENTITIES) {
    const model = deps.modelFor(entity);
    if (!model) continue;

    /*
      Replies come with the lines they answer. A reply is a child of nothing — it is in the `thread`
      of the line it answers (see `@shared/responses`) — so each line is read with its thread, and
      the two together are everything said in the conversation. A call held about a line is in its
      thread too; it carries no text, so the checks below leave it out.
    */
    const rows = withThreads(
      (await model.findAll(deps.handle, {
        // The collection's own parts, by the relation's name; the backend knows how it stores them.
        parent: { id: collectionId, relation: 'children', entity: 'CollectionBlock' },
        include: { thread: true },
        ...(options.limit !== undefined ? { limit: options.limit } : {}),
      })) as Record<string, unknown>[],
    );

    for (const row of rows) {
      const text = typeof row.text === 'string' ? row.text.trim() : '';
      const speaker = typeof row.author === 'string' ? row.author : '';
      const timestamp = isoTimestamp(row.createdAt);
      if (!text || !speaker || !timestamp) continue;
      // Carried where the block says so, absent where it does not — which is every block written
      // before `TextBlock.source` existed, and every one a turn entity other than TextBlock
      // contributes. A consumer that renders these is asserting somebody's words; this is what lets
      // it say which of them were spoken aloud.
      const source = typeof row.source === 'string' ? row.source : '';
      // Only what a person said or wrote — see `INPUT_SOURCES`.
      if (!(INPUT_SOURCES as readonly string[]).includes(source)) continue;
      turns.push({ speaker, text, timestamp, source });
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
