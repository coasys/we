import type { OperationDefinition, OperationParam } from '@we/backend-shared';

/*
  The writes behind a board — see docs/architecture/boards.md for the design they keep.

  A board is a CollectionBlock whose ordered `children` are its columns; a column's ordered
  `arranges` are the cards somebody put in it. A column bound to a state carries the state's `slug`,
  a lane carries none. The ordering itself is the backend's: these write whole lists and let it decide
  what moved.

  What stays with the host: which states the community offers (passed in as `states`), whatever is
  drawn ahead of a write, a workflow's agreement, a staged suggestion settled before a move, and the
  space's landmarks, which resolve to the newest by a rule the host reads them with.
*/

const STATES: OperationParam = {
  type: 'list',
  required: true,
  description: 'The states the community offers, in its own order, each { slug, name }.',
};

/*
  The title a column stores: nothing, when the name given is its state's own. A bound column's
  heading falls back to the state's current name, so a state renamed in the vocabulary renames its
  column on every board — storing the name would freeze it as of the day the column was made.
*/
const columnTitle = (name: string, slug: string) =>
  `${slug} && find(states, { slug: ${slug} }).name == trim(${name}) ? '' : trim(${name})`;

export const BOARDS_OPERATIONS: Record<string, OperationDefinition> = {
  /*
    A board's columns are written with it rather than made on its first drag. Made lazily, two members
    dragging at once would both find no columns and both make them, and the first drag anybody made
    would rebuild the column list under them. Making a board is already one person's deliberate act,
    so the work is done there, in the same run, and nobody sees a board with no columns.
  */
  createBoard: {
    description:
      'Make a board with a column for each state given, in that order; optionally inside a collection and gathering from a record.',
    params: {
      title: { type: 'string', required: true, description: 'What the board is called.' },
      states: {
        type: 'list',
        required: true,
        description: 'The slugs of the states to make a column for, in order, each once.',
      },
      parent: {
        type: 'string',
        description: 'A collection to put the board in. Left loose when the collection is not there.',
      },
      gathers: {
        type: 'string',
        description: 'The record the board draws its work from. Omit for a board showing only what is put on it.',
      },
    },
    steps: [
      {
        create: {
          as: 'board',
          entity: 'CollectionBlock',
          // `mode: 'feed'`: a board's children are columns several people write, never one author's document.
          fields: {
            $: "merge({ kind: 'board', mode: 'feed', title: trim(title) }, gathers ? { gathers: [gathers] } : {})",
          },
        },
      },
      {
        forEach: {
          in: { $: 'states' },
          as: 'slug',
          key: { $: 'slug' },
          steps: [
            {
              create: {
                entity: 'CollectionBlock',
                fields: { kind: 'column', mode: 'feed', slug: { $: 'slug' } },
                parent: { id: { $: 'board.id' }, relation: 'children', entity: 'CollectionBlock' },
              },
            },
          ],
        },
      },
      { find: { as: 'container', entity: 'CollectionBlock', where: { id: { $: 'parent' } } } },
      {
        link: {
          entity: 'CollectionBlock',
          id: { $: 'parent' },
          relation: 'children',
          target: { $: 'board.id' },
        },
        when: { $: 'count(container) > 0' },
      },
    ],
    returns: { $: 'board.id' },
  },

  openBoardFor: {
    description:
      'The board a collection points at, made — gathering from the collection, inside it — when it has none yet. Answers with its id, or nothing when the collection is not there.',
    params: {
      anchor: { type: 'string', required: true, description: 'The collection whose board this is.' },
      title: { type: 'string', description: 'What a board made here is called; "This call" when omitted.' },
      states: { type: 'list', required: true, description: 'The slugs a new board gets a column for, in order.' },
    },
    steps: [
      { find: { as: 'found', entity: 'CollectionBlock', where: { id: { $: 'anchor' } } } },
      {
        call: {
          as: 'made',
          operation: 'core.createBoard',
          args: {
            title: { $: "title && trim(title) != '' ? title : 'This call'" },
            states: { $: 'states' },
            parent: { $: 'anchor' },
            gathers: { $: 'anchor' },
          },
        },
        when: { $: 'count(found) > 0 && !first(found).board' },
      },
      /*
        The collection points at its board, rather than the board carrying a marker: a single-valued
        link converges when two members make one at once, and the other is left an ordinary board.
        A to-one written as a one-element list, as a create writes one.
      */
      {
        update: { entity: 'CollectionBlock', id: { $: 'anchor' }, fields: { board: [{ $: 'made' }] } },
        when: { $: 'made' },
      },
    ],
    returns: { $: "count(found) == 0 ? '' : first(found).board ? first(found).board : made" },
  },

  ensureBoardFor: {
    description:
      'Give a collection a board once it holds a task, and not before; answers with the board’s id, or nothing while it holds no task.',
    params: {
      collection: { type: 'string', required: true, description: 'The collection — a call, usually.' },
      states: { type: 'list', required: true, description: 'The slugs a new board gets a column for, in order.' },
    },
    steps: [
      { find: { as: 'found', entity: 'CollectionBlock', where: { id: { $: 'collection' } } } },
      // Its children's ids, asked whether any is a task — one read, rather than hydrating them all.
      {
        find: {
          as: 'tasks',
          entity: 'TaskBlock',
          where: { id: { $: 'first(found).children' } },
          limit: 1,
        },
        when: { $: 'count(found) > 0 && !first(found).board' },
      },
      {
        call: {
          as: 'opened',
          operation: 'core.openBoardFor',
          args: {
            anchor: { $: 'collection' },
            title: { $: "first(found).title ? first(found).title : 'This call'" },
            states: { $: 'states' },
          },
        },
        when: { $: 'count(tasks) > 0' },
      },
    ],
    returns: { $: "count(found) == 0 ? '' : first(found).board ? first(found).board : opened ?? ''" },
  },

  makeSpaceBoard: {
    description:
      'Make the space’s own board — gathering from the space collection, or from the space where it has none — and name it the space’s board landmark.',
    params: {
      space: { type: 'string', required: true, description: 'The Space record’s id.' },
      root: { type: 'string', description: 'The space collection’s id, where the space has one.' },
      title: { type: 'string', description: 'What the board is called; "Everything" when omitted.' },
      states: { type: 'list', required: true, description: 'The slugs to make a column for, in order.' },
    },
    steps: [
      {
        call: {
          as: 'made',
          operation: 'core.createBoard',
          args: {
            title: { $: "title && trim(title) != '' ? title : 'Everything'" },
            states: { $: 'states' },
            parent: { $: 'root' },
            gathers: { $: 'root ?? space' },
          },
        },
      },
      {
        create: {
          entity: 'SpaceLandmark',
          fields: { name: 'board', node: [{ $: 'made' }] },
          parent: { id: { $: 'space' }, relation: 'landmarks', entity: 'Space' },
        },
      },
    ],
    returns: { $: 'made' },
  },

  addBoardColumn: {
    description:
      'Add a column to a board: bound to a state when a slug is given — work in that state arrives on its own — or a lane of this board’s own when not.',
    params: {
      board: { type: 'string', required: true, description: 'The board.' },
      name: {
        type: 'string',
        description: 'The column’s heading. Stored only where it differs from its state’s name.',
      },
      slug: { type: 'string', description: 'The state the column stands for. Omit for a lane.' },
      states: STATES,
    },
    steps: [
      { find: { as: 'found', entity: 'CollectionBlock', where: { id: { $: 'board' } } } },
      {
        create: {
          entity: 'CollectionBlock',
          fields: { kind: 'column', mode: 'feed', title: { $: columnTitle('name', 'slug') }, slug: { $: 'slug' } },
          parent: { id: { $: 'board' }, relation: 'children', entity: 'CollectionBlock' },
        },
        when: { $: "count(found) > 0 && (slug || trim(name ?? '') != '')" },
      },
    ],
  },

  addStateColumn: {
    description:
      'Give a board a column for a state, unless one of its columns is already bound to it — what naming a new state does to the space’s own board.',
    params: {
      board: { type: 'string', required: true, description: 'The board.' },
      slug: { type: 'string', required: true, description: 'The state.' },
      name: { type: 'string', description: 'The state’s name.' },
      states: STATES,
    },
    steps: [
      { find: { as: 'found', entity: 'CollectionBlock', where: { id: { $: 'board' } } } },
      { find: { as: 'bound', entity: 'CollectionBlock', where: { kind: 'column', slug: { $: 'slug' } } } },
      {
        call: {
          operation: 'core.addBoardColumn',
          args: { board: { $: 'board' }, name: { $: 'name' }, slug: { $: 'slug' }, states: { $: 'states' } },
        },
        when: { $: 'count(found) > 0 && !bound.exists(c, c.id in (first(found).children ?? []))' },
      },
    ],
  },

  removeBoardColumn: {
    description:
      'Take a column off a board — never the work in it: its cards move to the board’s own arrangement, so a made board keeps them.',
    params: {
      board: { type: 'string', required: true, description: 'The board.' },
      column: { type: 'string', required: true, description: 'The column.' },
    },
    steps: [
      { find: { as: 'boards', entity: 'CollectionBlock', where: { id: { $: 'board' } } } },
      { find: { as: 'columns', entity: 'CollectionBlock', where: { id: { $: 'column' } } } },
      {
        setRelation: {
          entity: 'CollectionBlock',
          id: { $: 'board' },
          relation: 'arranges',
          targets: { $: 'distinct(first(boards).arranges, first(columns).arranges)' },
        },
        when: {
          $: 'count(boards) > 0 && count(distinct(first(boards).arranges, first(columns).arranges)) > count(first(boards).arranges)',
        },
      },
      {
        setRelation: {
          entity: 'CollectionBlock',
          id: { $: 'board' },
          relation: 'children',
          targets: { $: 'without(first(boards).children, column)' },
        },
        when: { $: 'count(boards) > 0' },
      },
      /*
        Only an actual column is deleted. An id resolves to a CollectionBlock whatever the record
        turns out to be, so a board whose children were polluted would otherwise have "remove this
        column" delete something else. Taking it off the board is right either way.
      */
      {
        delete: { entity: 'CollectionBlock', id: { $: 'column' } },
        when: { $: "first(columns).kind == 'column'" },
      },
    ],
  },

  renameBoardColumn: {
    description:
      'Rename a column on its board. The state it stands for is untouched; renamed back to the state’s own name, it follows the vocabulary again.',
    params: {
      column: { type: 'string', required: true, description: 'The column.' },
      name: { type: 'string', required: true, description: 'Its new heading.' },
      states: STATES,
    },
    steps: [
      { find: { as: 'found', entity: 'CollectionBlock', where: { id: { $: 'column' } } } },
      {
        update: {
          entity: 'CollectionBlock',
          id: { $: 'column' },
          fields: { title: { $: columnTitle('name', 'first(found).slug') } },
        },
        when: { $: "count(found) > 0 && trim(name) != ''" },
      },
    ],
  },

  reorderBoardColumns: {
    description:
      'Put a board’s columns in an order. Only ids the board already holds are written; any it holds that the order leaves out follow.',
    params: {
      board: { type: 'string', required: true, description: 'The board.' },
      ids: { type: 'list', required: true, description: 'Column ids, in the order wanted.' },
    },
    steps: [
      { find: { as: 'found', entity: 'CollectionBlock', where: { id: { $: 'board' } } } },
      {
        setRelation: {
          entity: 'CollectionBlock',
          id: { $: 'board' },
          relation: 'children',
          targets: {
            $: 'concat(ids.filter(i, i in first(found).children), first(found).children.filter(i, !(i in ids)))',
          },
        },
        when: { $: 'count(found) > 0 && ids.exists(i, i in first(found).children)' },
      },
    ],
    returns: {
      found: { $: 'count(found) > 0' },
      written: { $: 'count(found) > 0 && ids.exists(i, i in first(found).children)' },
    },
  },

  arrangeColumn: {
    description:
      'Store the order of a column’s cards: the ids given, then whatever the column still holds that they leave out.',
    params: {
      column: {
        type: 'string',
        required: true,
        description: 'The column (or a board, for what it holds in no column).',
      },
      ids: { type: 'list', required: true, description: 'Card ids, in the order wanted.' },
    },
    steps: [
      { find: { as: 'found', entity: 'CollectionBlock', where: { id: { $: 'column' } } } },
      {
        setRelation: {
          entity: 'CollectionBlock',
          id: { $: 'column' },
          relation: 'arranges',
          targets: { $: 'concat(ids, (first(found).arranges ?? []).filter(i, !(i in ids)))' },
        },
        when: { $: 'count(found) > 0' },
      },
    ],
    returns: { found: { $: 'count(found) > 0' } },
  },

  moveCard: {
    description:
      'Move a card from one column to another, in one transaction: it leaves the first, joins the second (where it was dropped, or at the end), and takes the second’s state when that column is bound to one.',
    params: {
      to: { type: 'string', required: true, description: 'The column it joins.' },
      from: { type: 'string', description: 'The column it leaves.' },
      card: { type: 'string', required: true, description: 'The card.' },
      ids: {
        type: 'list',
        description: 'The joined column’s order with the card where it was dropped. Omit to append.',
      },
    },
    steps: [
      { find: { as: 'target', entity: 'CollectionBlock', where: { id: { $: 'to' } }, one: true } },
      // A lane writes no state: dropping a card under "Thursday" says nothing about whether it is done.
      {
        find: { as: 'task', entity: 'TaskBlock', where: { id: { $: 'card' } } },
        when: { $: 'target.slug' },
      },
      {
        setRelation: {
          entity: 'CollectionBlock',
          id: { $: 'to' },
          relation: 'arranges',
          targets: { $: 'concat(ids, (target.arranges ?? []).filter(i, !(i in ids)))' },
        },
        when: { $: 'card in (ids ?? [])' },
      },
      {
        link: { entity: 'CollectionBlock', id: { $: 'to' }, relation: 'arranges', target: { $: 'card' } },
        when: { $: '!(card in (ids ?? []))' },
      },
      {
        unlink: { entity: 'CollectionBlock', id: { $: 'from' }, relation: 'arranges', target: { $: 'card' } },
        when: { $: 'from && from != to' },
      },
      {
        update: { entity: 'TaskBlock', id: { $: 'card' }, fields: { status: { $: 'target.slug' } } },
        when: { $: 'count(task) > 0' },
      },
    ],
  },

  addTaskToColumn: {
    description:
      'Make a task in a column: parented to the collection the board gathers from where there is one, arranged into the column, in the state given.',
    params: {
      column: { type: 'string', required: true, description: 'The column.' },
      title: { type: 'string', required: true, description: 'The task’s title.' },
      status: { type: 'string', description: 'The state it starts in.' },
      anchor: { type: 'string', description: 'The collection it belongs to — the call the board gathers from.' },
      arrange: {
        type: 'boolean',
        description: 'Whether to arrange it into the column. False where its state is still to be agreed.',
      },
    },
    steps: [
      {
        create: {
          as: 'anchored',
          entity: 'TaskBlock',
          fields: { title: { $: 'trim(title)' }, status: { $: 'status' } },
          parent: { id: { $: 'anchor' }, relation: 'children', entity: 'CollectionBlock' },
        },
        when: { $: 'anchor' },
      },
      {
        create: { as: 'loose', entity: 'TaskBlock', fields: { title: { $: 'trim(title)' }, status: { $: 'status' } } },
        when: { $: '!anchor' },
      },
      {
        link: {
          entity: 'CollectionBlock',
          id: { $: 'column' },
          relation: 'arranges',
          target: { $: 'anchored ?? loose' },
        },
        when: { $: 'arrange != false' },
      },
    ],
    returns: { $: '(anchored ?? loose).id' },
  },
};
