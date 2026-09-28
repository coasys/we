import type { SchemaNode, TemplateSchema } from '@we/schema-shared';
import { ANCHOR_ID, anchorBanner, anchorScope, emptyState, field, formModal, taskBoard } from '@we/template-kit';

/**
 * Boards — this space's work, arranged.
 *
 * The one task surface. There was a Tasks route beside this one, showing the same work with columns
 * from the space's vocabulary and no arrangement; it is gone, and its space-wide reading is the
 * **Everything** board at the top of this list. Two routes over one set of records disagreed about
 * what a column was, and only one of them could record an order.
 *
 * ## What a board is
 *
 * A `CollectionBlock` (`kind: 'board'`) whose ordered `children` are **column records**, each
 * holding its own ordered cards. The full reasoning — why a column is a saved query rather than a
 * container, why that is what survives a partition, and how swimlanes would fit — is
 * `docs/architecture/boards.md` and the docblock on `taskBoard`. The short version:
 *
 * - **A board never owns its work.** Delete a column and its cards keep their state, so they turn up
 *   in another column bound to it or in Unplaced. Delete the board and nothing is lost at all.
 * - **A card appears the moment it exists.** Extraction writes a state and no board links, so a
 *   board made tomorrow shows yesterday's work without anyone backfilling anything.
 * - **The same card sits differently on two boards, and is in one state on both.** Position is a
 *   fact about the pair; state is a fact about the work.
 *
 * ## Everything, and the boards people make
 *
 * The first row is the space's own board, made the first time somebody opens it — on a *click*
 * rather than on the route mounting. Creating a board writes records into a space everybody shares,
 * and doing that as a side effect of navigating would have every member who opened the tab racing to
 * create the same one.
 *
 * ## Anchoring
 *
 * `?anchor=<collection id>` narrows the list to the boards inside one container. A board made while
 * narrowed belongs to it. Absent means the space. What each board's cards are drawn from is not the
 * view's to say: a board carries `gathers`, and the fragment reads it.
 */

/**
 * The board its container calls its own — the space's, or the anchored container's.
 *
 * Which board is canonical is a fact about the **container**, so it is read from `Space.board` and
 * `CollectionBlock.board` rather than from a marker on the board. A marker could not stop two boards
 * claiming it; a single-valued link converges, and the board that loses the race is simply an
 * ordinary one in the list.
 */
const CANONICAL = `(${ANCHOR_ID.$} ? first(local.anchorRow).board.id : first(local.spaceRow).board.id)`;

/** The boards to choose from. Anchored, this is one container's; otherwise the space's. */
const boardsQuery = {
  entity: 'CollectionBlock',
  where: { kind: 'board' },
  scope: anchorScope(),
  // Oldest first, so the space's own board — the first one made — leads the list.
  order: { createdAt: 'asc' },
  limit: 50,
};

const createModal: SchemaNode = formModal({
  open: { $: 'local.createBoardOpen' },
  close: { $setLocal: 'createBoardOpen', value: false },
  title: 'New board',
  size: 'sm',
  localState: { boardTitle: { type: 'string', initial: '' } },
  children: [field({ name: 'boardTitle', label: 'What is this board for?', placeholder: 'Sprint 12' })],
  disabled: { $: '!local.boardTitle' },
  submitLabel: 'Create board',
  /*
    The anchor is passed as the parent, so a board made while the view is narrowed belongs to the
    container it was made in — otherwise it would be created into a list that does not list it. It
    opens straight away: the new id comes back as the action's own result.
  */
  submit: {
    $action: 'spaceStore.createBoard',
    args: [{ $: 'local.boardTitle' }, ANCHOR_ID],
    onSuccess: [
      { $setLocal: 'createBoardOpen', value: false },
      { $setLocal: 'boardId', value: { $: 'result' } },
    ],
  },
});

/** One row in the list of boards. */
const boardRow: SchemaNode = {
  type: 'we-button',
  props: { variant: 'bare', width: '100%', onClick: { $setLocal: 'boardId', value: { $: 'board.id' } } },
  children: [
    {
      type: 'Row',
      props: {
        width: '100%',
        gap: '300',
        ay: 'center',
        p: '300',
        bg: 'surface',
        r: '300',
        border: '1px solid border',
        hoverProps: { bg: 'surface-hover' },
      },
      children: [
        {
          type: 'we-icon',
          props: { name: { $: `board.id == ${CANONICAL} ? 'squares-four' : 'kanban'` }, color: 'accent-text' },
        },
        { type: 'we-text', props: { fontWeight: 'semibold' }, children: [{ $: 'board.title' }] },
        {
          type: '$if',
          props: {
            condition: { $: `board.id == ${CANONICAL}` },
            then: {
              type: 'we-text',
              props: { variant: 'footnote', color: 'text-muted', ml: 'auto' },
              children: [{ $: `${ANCHOR_ID.$} ? 'Everything from here' : 'Everything in this space'` }],
            },
          },
        },
      ],
    },
  ],
};

/**
 * The list of boards, with the space's own offered first.
 *
 * The Everything row is offered whether or not the board exists yet — `openBoardFor` finds it or
 * makes it and returns the id either way, so the row behaves identically before and after, and
 * nothing is written until somebody opens it. Hidden while anchored: a call's boards are its own,
 * and "everything in the space" is not one of them.
 */
const boardList: SchemaNode = {
  type: 'Column',
  props: { width: '100%', gap: '300' },
  children: [
    {
      type: '$if',
      props: {
        condition: { $: `!(${ANCHOR_ID.$}) && !first(local.spaceRow).board.id` },
        then: {
          type: 'we-button',
          props: {
            variant: 'bare',
            width: '100%',
            onClick: {
              $action: 'spaceStore.openBoardFor',
              args: ['', 'Everything'],
              onSuccess: [{ $setLocal: 'boardId', value: { $: 'result' } }],
            },
          },
          children: [
            {
              type: 'Row',
              props: {
                width: '100%',
                gap: '300',
                ay: 'center',
                p: '300',
                bg: 'surface',
                r: '300',
                border: '1px dashed border',
                hoverProps: { bg: 'surface-hover' },
              },
              children: [
                { type: 'we-icon', props: { name: 'squares-four', color: 'accent-text' } },
                { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Everything'] },
                {
                  type: 'we-text',
                  props: { variant: 'footnote', color: 'text-muted', ml: 'auto' },
                  children: ['Everything in this space'],
                },
              ],
            },
          ],
        },
      },
    },
    { type: '$each', props: { items: { $: 'local.boards' }, as: 'board' }, children: [boardRow] },
    {
      type: '$if',
      props: {
        condition: { $: `${ANCHOR_ID.$} && local.boardsLoaded && !count(local.boards)` },
        then: emptyState({
          icon: 'kanban',
          label: 'boards',
          message:
            'No board here yet. A board arranges work that already exists — making one never moves anything, and deleting one never loses any.',
        }),
      },
    },
  ],
};

/** One board, opened. */
const boardDetail: SchemaNode = {
  type: 'Column',
  props: { width: '100%', gap: '400' },
  $queries: { openBoard: { entity: 'CollectionBlock', where: { id: { $: 'local.boardId' } }, limit: 1 } },
  children: [
    {
      type: 'Row',
      props: { width: '100%', gap: '300', ay: 'center' },
      children: [
        {
          type: 'we-button',
          props: { variant: 'ghost', size: 'sm', onClick: { $setLocal: 'boardId', value: '' } },
          children: [
            { type: 'we-icon', props: { name: 'arrow-left' } },
            { type: 'we-text', children: ['All boards'] },
          ],
        },
        {
          type: 'we-text',
          props: { variant: 'heading-sm' },
          children: [{ $: 'first(local.openBoard).title' }],
        },
      ],
    },
    // What the board gathers, and from where, is the board's own to say — its `gathers` relation —
    // so the fragment needs nothing from this view but the id.
    taskBoard({
      boardId: { $: 'local.boardId' },
      // Extraction writes tasks onto these boards, so a reader can put away what nobody has kept.
      suggestions: true,
      empty: emptyState({
        icon: 'check-square',
        label: 'work',
        message:
          'Nothing to arrange yet. Add a card to a column, or record a call — extraction writes down what people commit to.',
      }),
    }),
  ],
};

export const boardsView: TemplateSchema = {
  meta: {
    name: 'Boards',
    description: "This space's work, arranged — everything in one board, or a board per piece of work",
    icon: 'kanban',
    role: 'view',
    // The task board's suggestion controls name `modules.transcribe.*` — see `taskBoard`. Declared so
    // a deployment without extraction sees the dependency rather than a board with dead buttons.
    requires: { modules: ['transcribe'] },
    segment: 'boards',
  },
  type: 'Column',
  props: { width: '100%', ax: 'center', p: '500' },
  /*
    `boardId` mirrors into the URL because it is view state: somebody sharing a link to a board means
    the board, and the recipient should see what the sender saw. `createBoardOpen` stays ephemeral —
    a half-open modal is nobody else's business.
  */
  $localState: {
    boardId: { type: 'string', initial: '', syncParam: { name: 'board', push: true } },
    createBoardOpen: { type: 'boolean', initial: false },
  },
  /*
    The boards to choose from, and which of them their container calls its own.

    `spaceRow` is the space's `board` relation — one row, always meaningful. `anchorRow` is the same
    question for the container a narrowed view is anchored to, and is only *read* while anchored: an
    unresolved `where` is pruned rather than sent, so unanchored it answers with an arbitrary
    collection, which the `ANCHOR_ID &&` guard below keeps harmless.
  */
  $queries: {
    boards: boardsQuery,
    spaceRow: { entity: 'Space', include: { board: true }, limit: 1 },
    anchorRow: { entity: 'CollectionBlock', where: { id: ANCHOR_ID }, include: { board: true }, limit: 1 },
  },
  children: [
    {
      type: 'Column',
      props: { width: '100%', maxWidth: 'var(--we-layout-lg)', gap: '400' },
      children: [
        {
          type: 'Row',
          props: { width: '100%', ay: 'center', gap: '300' },
          children: [
            { type: 'we-text', props: { variant: 'heading-sm' }, children: ['Boards'] },
            {
              type: 'we-button',
              props: { size: 'sm', ml: 'auto', onClick: { $setLocal: 'createBoardOpen', value: true } },
              children: ['New board'],
            },
          ],
        },
        anchorBanner({ label: 'boards' }),
        createModal,
        { type: '$if', props: { condition: { $: 'local.boardId' }, then: boardDetail, else: boardList } },
      ],
    },
  ],
};
