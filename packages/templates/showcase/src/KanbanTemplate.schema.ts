/**
 * Boards, columns and cards — coordination software from the same substrate as the social ones.
 *
 * The template that stops the showcase arguing the narrow thesis. Five of the six render
 * conversation; this one renders work, from the same `CollectionBlock`, with the same containment,
 * the same signals and the same per-agent state. If the engine were a social-media engine, this
 * template would need something the others do not have. It needs nothing.
 *
 * ## Containment expresses status
 *
 * A card's column *is* its status. `TaskBlock.status` exists and this template ignores it — two
 * ways to say one thing eventually disagree, and containment is the more general of the two: a
 * board can have whatever columns a community invents, where `status` is a fixed vocabulary
 * somebody else chose. Moving a card is a relink of two `we://children` edges, which is why it is
 * cheap and why nothing about the card changes.
 *
 * ## Ordering
 *
 * Cards sort by creation, and there is no drag-to-reorder. Ordering *within* a column needs a
 * conflict-free position — the AD4M CRDT ordering work — and a `position` scalar written now would
 * be a shape that design supersedes. Moving *between* columns works today, via a menu, because that
 * is containment rather than order.
 */
import type { RouteSchema, TemplateSchema } from '@we/schema-shared';
import { agentByline, collectionFeed, emptyState, kanbanBoard, moveCardMenu } from '@we/template-kit';

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
                onClick: { $action: 'routeStore.navigate', args: [{ $concat: ['/board/', '$board.id'] }] },
              },
              children: [
                {
                  type: 'Column',
                  props: {
                    width: '100%',
                    gap: '200',
                    p: '400',
                    bg: 'surface',
                    r: '400',
                    border: '1px solid border',
                    hoverProps: { borderColor: 'accent' },
                  },
                  children: [
                    { type: 'we-text', props: { fontWeight: 'semibold', truncate: true }, children: ['$board.title'] },
                    {
                      type: 'Row',
                      props: { gap: '100', ay: 'center' },
                      children: [
                        { type: 'we-number', props: { value: '$board.$columnCount' } },
                        {
                          type: 'we-text',
                          props: { variant: 'footnote', color: 'textFaint' },
                          children: [{ $plural: { count: '$board.$columnCount', one: 'column', other: 'columns' } }],
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
          navigateTo: '/board/',
        }),
      ],
    },
  ],
};

const boardRoute: RouteSchema = {
  path: '/board/:boardId',
  type: 'Column',
  props: { width: '100%', height: '100%' },
  $localState: { newColumnOpen: { type: 'boolean', initial: false } },
  $queries: signalTypesQuery,
  children: [
    {
      type: 'Row',
      props: {
        ax: 'between',
        ay: 'center',
        width: '100%',
        px: '500',
        py: '300',
        bg: 'surface',
        borderBottom: '1px solid border',
      },
      children: [
        {
          type: 'Row',
          props: { gap: '300', ay: 'center' },
          children: [
            {
              type: 'we-button',
              props: { variant: 'ghost', size: 'sm', onClick: { $action: 'routeStore.navigate', args: ['/'] } },
              children: [{ type: 'we-icon', props: { name: 'arrow-left' } }],
            },
            {
              type: '$single',
              props: {
                item: {
                  $query: {
                    entity: 'CollectionBlock',
                    where: { id: { $store: 'routeStore.segments.1' } },
                    limit: 1,
                  },
                },
                as: 'board',
              },
              children: [{ type: 'we-text', props: { variant: 'heading-sm' }, children: ['$board.title'] }],
            },
          ],
        },
        {
          type: 'we-button',
          props: { variant: 'secondary', size: 'sm', onClick: { $setLocal: 'newColumnOpen', value: true } },
          children: [{ type: 'we-icon', props: { name: 'plus' } }, 'Column'],
        },
      ],
    },

    kanbanBoard({
      boardId: { $store: 'routeStore.segments.1' },
      empty: emptyState({
        icon: 'columns',
        label: 'columns',
        message: 'No columns yet. Add one — a card’s column is its status.',
        delay: 0,
      }),
      card: (as) => [
        {
          type: 'Column',
          props: {
            width: '100%',
            gap: '200',
            p: '300',
            bg: 'surface',
            r: '300',
            border: '1px solid border',
          },
          children: [
            {
              type: 'BlockRenderer',
              props: {
                editorState: `$${as}.editorState`,
              },
            },
            {
              type: 'Row',
              props: { ax: 'between', ay: 'center', width: '100%' },
              children: [
                agentByline({ did: `$${as}.author`, timestamp: `$${as}.createdAt`, avatarSize: 'xs' }),
                moveCardMenu(`$${as}`, '$column'),
              ],
            },
            signalRow(`$${as}`),
          ],
        },
      ],
      columnFooter: (as) => ({
        type: 'Column',
        props: { width: '100%' },
        $localState: { addCardOpen: { type: 'boolean', initial: false } },
        children: [
          {
            type: 'we-button',
            props: {
              variant: 'ghost',
              size: 'sm',
              width: '100%',
              onClick: { $setLocal: 'addCardOpen', value: true },
            },
            children: [{ type: 'we-icon', props: { name: 'plus' } }, 'Add card'],
          },
          composerModal({
            openLocal: 'addCardOpen',
            title: 'New card',
            // A card is a composed document like a post — same composer, same blocks. It is only a
            // card because of where it lives.
            kind: KIND.post,
            parentId: `$${as}.id`,
            saveLabel: 'Add',
          }),
        ],
      }),
    }),

    newContainerModal({
      openLocal: 'newColumnOpen',
      title: 'New column',
      kind: KIND.column,
      placeholder: 'In progress',
      parentId: { $store: 'routeStore.segments.1' },
    }),
  ],
};

export const kanbanTemplate: TemplateSchema = {
  meta: {
    name: 'Boards',
    description: 'Kanban boards where a card’s column is its status — coordination on the same substrate.',
    icon: 'kanban',
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
      children: [{ type: 'we-text', props: { color: 'textFaint' }, children: ['No such board.'] }],
    },
  ],
};
