/**
 * Boards, columns and cards — coordination software from the same substrate as the social ones.
 *
 * The template that stops the showcase arguing the narrow thesis. Five of the six render
 * conversation; this one renders work, from the same `CollectionBlock`, with the same signals and
 * the same per-agent state. If the engine were a social-media engine, this template would need
 * something the others do not have. It needs nothing.
 *
 * ## A card's column is where it sits
 *
 * Every column here is a **lane**: it arranges the cards somebody put in it and claims nothing about
 * them. That is the containment kanban, and it turns out to be a special case of WE's own board —
 * the one whose columns can also bind to a task state — with nothing bound. So this is the same
 * `taskBoard` fragment the Boards view renders, over composed posts, with `lanesOnly` set. One
 * board, two uses, and the showcase keeps its claim: nothing here mints a content model.
 *
 * ## Arrangement is a relation, not containment
 *
 * A column *arranges* its cards through `we://arranges` rather than owning them through
 * `we://children`. The cards are loose in the space; a column positions them. Deleting a column
 * therefore cannot delete a card, and two people dragging in the same column at once converge,
 * because an ordered relation is a conflict-free sequence in the backend.
 */
import type { RouteSchema, SchemaNode, TemplateSchema } from '@we/schema-shared';
import { agentByline, collectionFeed, emptyState, moveTaskMenu, taskBoard } from '@we/template-kit';

import { composerModal, KIND, newContainerModal, signalRow, signalTypesQuery } from './shared.ts';

const boardsRoute: RouteSchema = {
  path: '/',
  type: 'Column',
  props: { width: '100%', ax: 'center', p: '500' },
  $localState: { newBoardOpen: { type: 'boolean', initial: false } },
  children: [
    {
      type: 'Column',
      props: { width: '100%', maxWidth: 'var(--we-layout-lg)', gap: '400' },
      children: [
        {
          type: 'Row',
          props: { ax: 'between', ay: 'center', width: '100%' },
          children: [
            { type: 'we-text', props: { variant: 'heading-lg' }, children: ['Boards'] },
            {
              type: 'we-button',
              props: { variant: 'primary', size: 'sm', onClick: { $setLocal: 'newBoardOpen', value: true } },
              children: [{ type: 'we-icon', props: { name: 'plus' } }, 'New board'],
            },
          ],
        },
        collectionFeed({
          kind: KIND.board,
          as: 'board',
          include: { $columnCount: { from: 'children', count: true } },
          wrapper: (children) => ({
            type: 'Grid',
            props: { minChildWidth: '260px', gap: '400', width: '100%' },
            children,
          }),
          empty: emptyState({
            icon: 'kanban',
            label: 'boards',
            message: 'No boards yet. Make one to start organising work.',
          }),
          children: [
            {
              type: 'we-button',
              props: {
                variant: 'bare',
                width: '100%',
                onClick: { $action: 'routeStore.navigate', args: [{ $: '`./board/${board.id}`' }] },
              },
              children: [
                {
                  type: 'Column',
                  props: {
                    width: '100%',
                    gap: '200',
                    p: '400',
                    bg: 'surface-sunken',
                    r: '400',
                    border: '1px solid border',
                    hoverProps: { borderColor: 'accent' },
                  },
                  children: [
                    {
                      type: 'we-text',
                      props: { fontWeight: 'semibold', truncate: true },
                      children: [{ $: 'board.title' }],
                    },
                    {
                      type: 'Row',
                      props: { gap: '100', ay: 'center' },
                      children: [
                        { type: 'we-number', props: { value: { $: 'board.$columnCount' } } },
                        {
                          type: 'we-text',
                          props: { variant: 'footnote', color: 'text-faint' },
                          children: [{ $: "plural(board.$columnCount, 'column', 'columns')" }],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        }),
        newContainerModal({
          openLocal: 'newBoardOpen',
          title: 'New board',
          kind: KIND.board,
          placeholder: 'Roadmap',
          navigateTo: './board/',
        }),
      ],
    },
  ],
};

/**
 * One card: the composed post, who wrote it, where else it could go, and what people made of it.
 *
 * The board fragment draws `TaskBlock`s by default and this board holds posts, so the card is the
 * template's — which is the point of `card` being an option: the arrangement is the kit's and what
 * a card *is* stays the community's.
 */
function postCard(as: string): SchemaNode {
  return {
    type: 'Column',
    props: { width: '100%', gap: '200', p: '300', bg: 'surface', r: '300', border: '1px solid border' },
    children: [
      { type: 'BlockRenderer', props: { editorState: { $: `${as}.editorState` } } },
      {
        type: 'Row',
        props: { ax: 'between', ay: 'center', width: '100%' },
        children: [
          agentByline({ did: { $: `${as}.author` }, timestamp: { $: `${as}.createdAt` }, avatarSize: 'xs' }),
          // The keyboard path beside dragging; every column here is a lane, so a move writes one link.
          moveTaskMenu('col.id', as),
        ],
      },
      signalRow(as),
    ],
  };
}

const boardRoute: RouteSchema = {
  path: '/board/:boardId',
  type: 'Column',
  props: { width: '100%', height: '100%' },
  $queries: signalTypesQuery,
  children: [
    {
      type: 'Row',
      props: {
        gap: '300',
        ay: 'center',
        width: '100%',
        px: '500',
        py: '300',
        bg: 'surface-sunken',
        borderBottom: '1px solid border',
      },
      children: [
        {
          type: 'we-button',
          props: { variant: 'ghost', size: 'sm', onClick: { $action: 'routeStore.navigate', args: ['.'] } },
          children: [{ type: 'we-icon', props: { name: 'arrow-left' } }],
        },
        {
          type: '$single',
          props: {
            item: {
              $query: {
                entity: 'CollectionBlock',
                where: { id: { $: 'routeStore.templateSegments[1]' } },
                limit: 1,
              },
            },
            as: 'board',
          },
          children: [{ type: 'we-text', props: { variant: 'heading-sm' }, children: [{ $: 'board.title' }] }],
        },
      ],
    },
    {
      type: 'Column',
      props: { width: '100%', p: '400' },
      children: [
        /*
          The same board WE's own Boards view renders, over posts instead of tasks and with every
          column a lane. That is what "containment expresses status" turns out to be: the special
          case of the state board where nothing binds. Dragging reorders within a column and moves
          between them, and both converge when two people do it at once, because a column's
          arrangement is an ordered relation.
        */
        taskBoard({
          boardId: { $: 'routeStore.templateSegments[1]' },
          entity: 'CollectionBlock',
          where: { kind: KIND.post },
          lanesOnly: true,
          card: postCard,
          /*
            A card is a composed document like a post — same composer, same blocks. It is only a
            card because of where it is arranged: the composer writes the post loose in the space,
            and the close handler puts it in the column that was pressed. `result` is the new id.
          */
          addCardModal: composerModal({
            openLocal: 'addOpen',
            title: 'New card',
            kind: KIND.post,
            saveLabel: 'Add',
            onClose: [{ $action: 'spaceStore.moveCardToColumn', args: ['', { $: 'col.id' }, { $: 'result' }] }],
          }),
          empty: emptyState({
            icon: 'columns',
            label: 'columns',
            message: 'No columns yet. Add one — a card’s column is where it sits.',
            delay: 0,
          }),
        }),
      ],
    },
  ],
};

export const kanbanTemplate: TemplateSchema = {
  meta: {
    name: 'Boards',
    description: 'Kanban boards where a card’s column is its status — coordination on the same substrate.',
    icon: 'kanban',
    // The board's suggestion controls name `modules.transcribe.*` — see `taskBoard`. Declared so a
    // deployment without extraction sees the dependency in `missingModules` rather than dead buttons.
    requires: { modules: ['transcribe'] },
    // Light: a board is read at a glance, and it sets coordination apart from the social three.
    themeId: 'light',
  },
  type: 'Column',
  props: { bg: 'page', width: '100%', minHeight: '100%' },
  children: [{ type: '$routes' }],
  routes: [
    boardsRoute,
    boardRoute,
    {
      path: '*',
      type: 'Column',
      props: { p: '600', ax: 'center' },
      children: [{ type: 'we-text', props: { color: 'text-faint' }, children: ['No such board.'] }],
    },
  ],
};
