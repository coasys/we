/**
 * A board of columns of cards — coordination software from the same substrate as the social ones.
 *
 * Board and column are both `CollectionBlock`s (`kind: 'board'`, `kind: 'column'`, both feed-mode);
 * a card is whatever block the caller renders, held in a column's `children`. Moving a card between
 * columns is a relink, not an edit.
 *
 * ## Containment expresses status
 *
 * `TaskBlock` has a `status` field, and a board has columns. Those are two ways to say the same
 * thing, and this fragment picks containment: a card's column *is* its status. That is the more
 * general answer — a board can have any columns a community invents, where `status` is a fixed
 * vocabulary — and it means the card and the board cannot disagree, which two sources of truth for
 * one fact eventually do.
 *
 * The consequence, stated so it is a decision rather than an oversight: `TaskBlock.status` is
 * redundant inside a board and this fragment neither reads nor writes it. A template mixing the two
 * — a status dropdown *and* columns — will produce exactly the disagreement described above.
 *
 * ## Ordering
 *
 * Cards are ordered by `createdAt`, and there is no drag-to-reorder. Manual ordering needs a
 * conflict-free position, which is the AD4M CRDT ordering work; a `position` scalar written now
 * would be a shape that design supersedes, and a read-modify-write over an order array would drop
 * whichever of two simultaneous movers lost. Moving a card *between* columns works today, because
 * that is a relink rather than an ordering.
 */
import type { SchemaNode } from '@we/schema-shared';

import { emptyNote } from '../states/emptyState.ts';
import type { AnchorId } from '../types.ts';

export interface KanbanBoardOptions {
  /** Id of the board collection whose children are the columns — usually a route segment. */
  boardId: AnchorId;
  /** Renders one card. Receives the context key. */
  card: (as: string) => SchemaNode[];
  /** Node appended inside each column — an "add card" button. Receives the column context key. */
  columnFooter?: (as: string) => SchemaNode;
  /** Node appended after the last column — an "add column" button. */
  boardFooter?: SchemaNode;
  /** Shown when the board has no columns yet. */
  empty: SchemaNode;
  /** Width of each column. Defaults to `'300px'`. */
  columnWidth?: string;
}

export function kanbanBoard(opts: KanbanBoardOptions): SchemaNode {
  return {
    type: 'Row',
    props: { gap: '400', width: '100%', ay: 'start', overflow: 'auto', p: '400' },
    $queries: {
      columnRows: {
        entity: 'CollectionBlock',
        where: { kind: 'column' },
        scope: { anchor: 'CollectionBlock', via: 'children', anchorId: opts.boardId },
        order: { createdAt: 'asc' },
        include: { $cardCount: { from: 'children', count: true } },
      },
    },
    children: [
      {
        type: '$if',
        props: {
          condition: { $count: { items: { $local: 'columnRows' } } },
          then: {
            type: '$each',
            props: { items: { $local: 'columnRows' }, as: 'column' },
            children: [
              {
                type: 'Column',
                props: {
                  width: opts.columnWidth ?? '300px',
                  flex: '0 0 auto',
                  gap: '300',
                  p: '300',
                  r: '400',
                  bg: 'surface-sunken',
                  border: '1px solid border',
                },
                $queries: {
                  cardRows: {
                    entity: 'CollectionBlock',
                    scope: { anchor: 'CollectionBlock', via: 'children', anchorId: '$column.id' },
                    order: { createdAt: 'asc' },
                    include: { signals: true },
                  },
                },
                children: [
                  {
                    type: 'Row',
                    props: { ax: 'between', ay: 'center', width: '100%' },
                    children: [
                      {
                        type: 'we-text',
                        props: { fontWeight: 'semibold', truncate: true },
                        children: ['$column.title'],
                      },
                      {
                        type: 'we-badge',
                        props: { size: 'sm' },
                        children: [{ type: 'we-number', props: { value: '$column.$cardCount' } }],
                      },
                    ],
                  },
                  {
                    type: '$if',
                    props: {
                      condition: { $count: { items: { $local: 'cardRows' } } },
                      then: {
                        type: 'Column',
                        props: { gap: '200', width: '100%' },
                        children: [
                          {
                            type: '$each',
                            props: { items: { $local: 'cardRows' }, as: 'card' },
                            children: opts.card('card'),
                          },
                        ],
                      },
                      else: emptyNote('Nothing here yet.'),
                    },
                  },
                  ...(opts.columnFooter ? [opts.columnFooter('column')] : []),
                ],
              },
            ],
          },
          else: { type: '$if', props: { condition: { $local: 'columnRowsLoaded' }, then: opts.empty } },
        },
      },
      ...(opts.boardFooter ? [opts.boardFooter] : []),
    ],
  };
}

/**
 * The control that moves a card to another column — a dropdown of sibling columns.
 *
 * A relink rather than a field write: the card is removed from this column's `children` and added
 * to the target's. Presented as a menu rather than as drag-and-drop because dragging needs a drop
 * target, a pointer behaviour and an ordering to drop *into*, and the last of those is the piece
 * waiting on CRDT ordering. A menu moves a card correctly today and keeps working when dragging
 * arrives beside it.
 */
export function moveCardMenu(cardRef: string, columnRef: string): SchemaNode {
  return {
    type: 'DropdownMenu',
    props: {
      triggerIcon: 'arrows-left-right',
      // Names the menu, since the glyph alone does not. Until icon-only triggers were inferred this
      // read "Options" beside the arrows — the fallback label, which no caller here ever asked for.
      triggerTitle: 'Move this card',
      size: 'xs',
      items: {
        $map: {
          items: { $local: 'columnRows' },
          select: {
            id: '$item.id',
            label: '$item.title',
            onAction: {
              $action: 'spaceStore.moveChild',
              args: [`${cardRef}.id`, `${columnRef}.id`, '$item.id'],
            },
          },
        },
      },
    },
  };
}
