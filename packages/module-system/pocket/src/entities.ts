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
        /**
         * The record this one sits inside, where it is a block — the post a kept paragraph or picture
         * came from. Same dataset as `datasetKey`, so only the entity and id.
         *
         * Opening a paragraph goes to its post, and a block's own id may not outlive an edit that
         * splits or merges it; the post is what stays. Empty for anything that is a place of its own.
         */
        withinEntity: { type: 'string', default: '' },
        withinId: { type: 'string', default: '' },

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

  /*
    The Pocket's writes, declared — run in the personal space through the agent-data kernel, under
    the module's id (`pocket.gather`). What stays in the store is what only it knows: which folder is
    open, what reference a drop names, and the picture a document carries.
  */
  operations: {
    rootFolder: {
      description:
        'The Pocket’s root folder — the one everything else hangs off — made the first time it is asked for.',
      steps: [
        { find: { as: 'found', entity: 'PocketFolder', where: { root: true }, limit: 1 } },
        {
          create: { as: 'made', entity: 'PocketFolder', fields: { name: 'Pocket', icon: 'bag-simple', root: true } },
          when: { $: 'count(found) == 0' },
        },
      ],
      returns: { $: 'count(found) > 0 ? first(found) : made' },
    },

    gather: {
      description:
        'Keep a reference in the Pocket, in a folder or at its root. Something already held is moved to the folder rather than kept twice.',
      params: {
        ref: { type: 'string', required: true, description: 'The record URI — we:<datasetKey>/<Entity>/<id>.' },
        entity: { type: 'string', description: 'The reference’s entity, written out beside it.' },
        datasetKey: { type: 'string', description: 'Its dataset key.' },
        recordId: { type: 'string', description: 'Its record id.' },
        withinEntity: { type: 'string', description: 'The record it sits inside, where it is a block.' },
        withinId: { type: 'string', description: 'That record’s id.' },
        label: { type: 'string', description: 'How it read when it was gathered.' },
        icon: { type: 'string', description: 'Its icon.' },
        thumbnail: { type: 'string', description: 'Its picture.' },
        sourceName: { type: 'string', description: 'The space it came from, by name.' },
        sourceAuthor: { type: 'string', description: 'Whoever wrote it.' },
        into: { type: 'string', description: 'The folder to keep it in; the root when omitted.' },
        origin: {
          type: 'object',
          description:
            'Where a row dragged out of the Pocket came from — { id, folder } — so a drop elsewhere moves it.',
        },
      },
      steps: [
        // Gathering the same thing twice is a move or nothing, never a second row.
        { find: { as: 'already', entity: 'PocketItem', where: { ref: { $: 'ref' } }, limit: 1 } },
        {
          call: {
            as: 'moved',
            operation: 'pocket.refile',
            args: { item: { $: 'origin.id' }, from: { $: 'origin.folder' }, into: { $: 'into' } },
          },
          when: { $: 'count(already) > 0 && origin.id && origin.folder && into && origin.folder != into' },
        },
        { call: { as: 'root', operation: 'pocket.rootFolder', args: {} }, when: { $: 'count(already) == 0 && !into' } },
        {
          create: {
            as: 'made',
            entity: 'PocketItem',
            fields: {
              ref: { $: 'ref' },
              entity: { $: 'entity' },
              datasetKey: { $: 'datasetKey' },
              recordId: { $: 'recordId' },
              withinEntity: { $: 'withinEntity' },
              withinId: { $: 'withinId' },
              label: { $: 'label' },
              icon: { $: 'icon' },
              thumbnail: { $: 'thumbnail' },
              sourceName: { $: 'sourceName' },
              sourceAuthor: { $: 'sourceAuthor' },
              // When *you* kept it, which is not when the thing was made or when the record synced.
              gatheredAt: { $: 'invokedAt' },
            },
            parent: { id: { $: 'into ?? root.id' }, relation: 'items', entity: 'PocketFolder' },
          },
          when: { $: 'count(already) == 0' },
        },
      ],
      returns: { $: 'count(already) > 0 ? (moved ?? first(already).id) : made.id' },
    },

    refile: {
      description:
        'Move an item from one folder to another. The item keeps its id and everything it says, gatheredAt included.',
      params: {
        item: { type: 'string', required: true, description: 'The PocketItem.' },
        from: { type: 'string', required: true, description: 'The folder it is in.' },
        into: { type: 'string', required: true, description: 'The folder it moves to.' },
      },
      steps: [
        {
          unlink: { entity: 'PocketFolder', id: { $: 'from' }, relation: 'items', target: { $: 'item' } },
          when: { $: 'from != into' },
        },
        {
          link: { entity: 'PocketFolder', id: { $: 'into' }, relation: 'items', target: { $: 'item' } },
          when: { $: 'from != into' },
        },
      ],
      returns: { $: 'item' },
    },

    removeFolders: {
      description:
        'Delete folders and everything kept in them, in the order given — the deepest first, so a parent outlives its children.',
      params: {
        folders: { type: 'list', required: true, description: 'The folders’ ids, a folder after everything under it.' },
      },
      steps: [
        {
          forEach: {
            in: { $: 'folders' },
            as: 'folder',
            key: { $: 'folder' },
            steps: [
              {
                find: {
                  as: 'kept',
                  entity: 'PocketItem',
                  scope: { anchor: 'PocketFolder', via: 'items', anchorId: { $: 'folder' } },
                },
              },
              {
                forEach: {
                  in: { $: 'kept' },
                  as: 'item',
                  steps: [{ delete: { entity: 'PocketItem', id: { $: 'item' } } }],
                },
              },
              { delete: { entity: 'PocketFolder', id: { $: 'folder' } } },
            ],
          },
        },
      ],
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
