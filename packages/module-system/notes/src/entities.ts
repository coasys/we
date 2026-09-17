import type { EntityManifest } from '@we/backend-shared';

/**
 * What the notes module owns — and a note is not one of them.
 *
 * ## A note is a post
 *
 * A note is a `CollectionBlock` of `kind: 'post'` in the agent's personal space: the same record, the
 * same blocks, the same composer and the same card renderer as a post in a community. What makes it
 * a note is only where it lives, and the personal space already says the one thing a separate kind
 * would — that nobody else can see it. A `note` kind would repeat that fact and could contradict it.
 *
 * That is also what makes sharing one a copy with nothing translated: the same composition, written
 * into a space, is a post there.
 *
 * ## What is owned: where a note was shared
 *
 * `NoteShare` records that a note was copied into a space, and as what. It lives beside the note, in
 * the personal space, and points *outward* at the post by reference. The post carries nothing back:
 * a reference into somebody's personal space would name a record nobody else can open, and would say
 * that a private note exists at all.
 *
 * `noteId` is a scalar rather than a relation so "where has this note been shared" is a native
 * equality in a `where`, which the card asks on every render — the reason the Pocket's item names its
 * record by string. `ref` is a scalar because it could not be anything else: a link's target lives in
 * the same dataset as its source, and a post in a space is by definition not in this one.
 *
 * ## The predicate namespace
 *
 * `we://module/notes/<property>` (snake-cased), minted by the compiler from the names below — the
 * convention this module set when it was the first to own an entity. Predicates are how existing data
 * is found; they are identifiers, never edited in place.
 */
export const NOTES_MANIFEST: EntityManifest = {
  version: '1',
  entities: {
    NoteShare: {
      properties: {
        /** The note, by its id in the personal space. */
        noteId: { type: 'string', required: true, default: '' },
        /** The post it became — `we:<datasetKey>/CollectionBlock/<id>`. */
        ref: { type: 'string', required: true, default: '' },
        /** The space's name when it was shared, so a card can say where without resolving anything. */
        spaceName: { type: 'string', default: '' },
        /** When. Stamped by the module: when *you* shared it, not when the record happened to sync. */
        sharedAt: { type: 'string', default: '' },
      },
      relations: {},
    },
  },
};

/** The predicates this module owns — named so the scheme stays greppable and testable. */
export const NOTE_PREDICATES = {
  noteId: 'we://module/notes/note_id',
  ref: 'we://module/notes/ref',
  spaceName: 'we://module/notes/space_name',
  sharedAt: 'we://module/notes/shared_at',
} as const;

/** The kind a note is written as — a post's. See the header. */
export const NOTE_KIND = 'post';
