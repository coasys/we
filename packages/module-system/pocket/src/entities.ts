import type { EntityManifest } from '@we/backend-shared';

/**
 * What the Pocket stores, declared rather than written against a backend.
 *
 * ## Two entities, not one
 *
 * A folder is a container and an item is a reference, and conflating them would give every item an
 * unused `children` relation and every folder an unused `ref`. `docs/architecture/relations.md`
 * rule 4 puts containment in a declared relation: it is written by code, per record, as part of
 * creating that record, and queried constantly.
 *
 * The nesting is fractal for free, because a folder's `folders` relation targets its own type. A
 * folder in a folder is not a special case anywhere.
 *
 * ## Ad4mModel, not WeNode
 *
 * These extend nothing. Comments, signals, participants and mentions on a private per-agent record
 * mean nothing, and inheriting them invites somebody to wire them up — a comment thread on a
 * bookmark only you can see is not a feature, it is a misunderstanding waiting to be built.
 *
 * ## Why the snapshot sits beside the reference
 *
 * `PocketItem` stores `ref` **and** a copy of how the thing looked when it was gathered. Three
 * reasons, and they compound:
 *
 * - **The panel draws with no cross-dataset work at all.** A reference alone would mean resolving
 *   every visible row against a different dataset before anything could be painted — and a template
 *   cannot even express that, since `$query`'s `dataset` is a store path rather than something a row
 *   can name.
 * - **An item whose space you left still reads as something.** A bare reference degrades to a blank
 *   row and a shrug.
 * - **It is honest.** A pocket is a memory of a thing as you saw it. A bookmark that silently
 *   becomes a different post because somebody edited it is not what anybody meant by keeping it.
 *
 * Re-resolution is best-effort and on demand — see the store's `refresh`.
 */
export const POCKET_MANIFEST: EntityManifest = {
  version: '1',
  entities: {
    PocketFolder: {
      properties: {
        name: { type: 'string', default: '' },
        icon: { type: 'string', default: '' },
        color: { type: 'string', default: '' },
        /**
         * The one folder everything else hangs off, created on the first gather.
         *
         * A root record rather than "items with no parent", because a relation's absence is not
         * something a `where` clause can ask about — so without it "what is at the top level" would
         * have no query.
         */
        root: { type: 'boolean', default: false },
        createdOrder: { type: 'number', default: 0 },
      },
      relations: {
        /** Nesting. Self-targeting, which is what makes folders fractal with no special case. */
        folders: { target: 'PocketFolder', cardinality: 'many' },
        items: { target: 'PocketItem', cardinality: 'many' },
      },
    },

    PocketItem: {
      properties: {
        /**
         * The record URI — `we:<datasetKey>/<Entity>/<id>`. See `@we/backend-shared`'s `recordRef`.
         *
         * A scalar rather than a relation, and it could not be anything else: a link's target lives
         * in the same dataset as its source, and this points somewhere else by definition. Being a
         * scalar is also what makes "have I gathered this already" a native equality.
         */
        ref: { type: 'string', required: true, default: '' },
        /**
         * The reference's three parts, written out beside it.
         *
         * Denormalised on purpose, and not laziness: a template cannot parse a string, so without
         * these a row could be *shown* but never dragged back out — `we-draggable` needs the parts
         * separately, and the alternative would be teaching the design system what a record URI is,
         * which is a dependency pointing the wrong way.
         */
        entity: { type: 'string', default: '' },
        datasetKey: { type: 'string', default: '' },
        recordId: { type: 'string', default: '' },

        // ── The snapshot: how it looked when it was gathered ──────────────────
        label: { type: 'string', default: '' },
        icon: { type: 'string', default: '' },
        thumbnail: { type: 'string', default: '' },
        /** The space it came from, by name — so a row can say where without resolving anything. */
        sourceName: { type: 'string', default: '' },
        /** Whoever wrote the thing, where the source knew. */
        sourceAuthor: { type: 'string', default: '' },
        gatheredAt: { type: 'string', default: '' },

        /** Anything the person wants to say about why they kept it. */
        note: { type: 'string', control: 'textarea', default: '' },
      },
      relations: {},
    },
  },
};

/** The predicates this module owns. Named so the scheme stays greppable and testable. */
export const POCKET_PREDICATES = {
  /** How an item attaches to the folder holding it. */
  items: 'we://module/pocket/items',
  /** How a folder attaches to its parent. */
  folders: 'we://module/pocket/folders',
} as const;
