import type { OperationDefinition, OperationParam } from '@we/backend-shared';

import { callSegment } from '../../operations/ids';
import { INLINE_PARAM } from './records';

/*
  The writes behind a canvas: where a card sits and how it looks (a Placement under the canvas), how
  a connection is drawn there (an EdgeRoute under the canvas), the connections themselves, and how a
  kind of record is coloured on a canvas or across the space (a TypeStyle).

  What stays with the host: which of several placements a canvas draws (the canvas seed's rule, which
  the host shares with it), a tree's ranks and its cycle check (pure kernels), an end's title for a
  connection's key (a read of whatever the end is), what is drawn ahead of a write, and undo.
*/

const canvasChild = (id: string) => ({ id: { $: id }, relation: 'children', entity: 'CollectionBlock' });

/**
 * Where `composeCard` calls `core.createPost` — its first step — as the path a block id derives
 * under (see `postBlockId`). Keep the two together.
 */
export const COMPOSE_CARD_POST: readonly string[] = ['0', callSegment('core.createPost')];

const CONNECTION: OperationParam = { type: 'string', required: true, description: 'The Relationship.' };

export const CANVAS_OPERATIONS: Record<string, OperationDefinition> = {
  /*
    A card composed on a canvas: a post (`core.createPost`, called) made wherever the canvas's
    content lives, and where it sits on the canvas, in one write — so the canvas never sees a card
    that exists and is nowhere. The host plans the post as for any other (`planPost`, with
    `COMPOSE_CARD_POST` as where its blocks' ids derive).
  */
  composeCard: {
    description:
      'Compose a card onto a canvas: the post, kept wherever the canvas’s content lives, and its placement on the canvas where a point is given.',
    params: {
      root: { type: 'object', required: true, description: 'The post’s own fields, as core.createPost takes them.' },
      blocks: { type: 'list', required: true, description: 'Its blocks, as core.createPost takes them.' },
      mentions: { type: 'list', description: 'The DIDs it mentions.' },
      home: { type: 'string', required: true, description: 'The collection the card is kept in.' },
      canvas: { type: 'string', required: true, description: 'The canvas it is placed on.' },
      at: { type: 'object', description: 'Where on the canvas, { x, y }. Without one it is unplaced, in the tray.' },
    },
    steps: [
      {
        call: {
          as: 'card',
          operation: 'core.createPost',
          args: { root: { $: 'root' }, blocks: { $: 'blocks' }, mentions: { $: 'mentions' }, container: { $: 'home' } },
        },
      },
      {
        create: {
          entity: 'Placement',
          fields: { nodeType: 'CollectionBlock', x: { $: 'at.x' }, y: { $: 'at.y' }, node: [{ $: 'card' }] },
          parent: canvasChild('canvas'),
        },
        when: { $: 'at' },
      },
    ],
    returns: { $: 'card' },
  },

  placeCard: {
    description:
      'Write where a card sits on a canvas, or how it looks there: the placement the canvas draws is edited, or one made where there is none, and duplicates beside it removed. Answers { from, to } — what the fields held before — for an undo.',
    params: {
      canvas: { type: 'string', required: true, description: 'The canvas.' },
      node: { type: 'string', required: true, description: 'The record the card is.' },
      nodeType: { type: 'string', description: 'Its entity, for a placement made here.' },
      fields: {
        type: 'object',
        required: true,
        description: 'Placement fields — x and y, a size, a colour, a rank …',
      },
      placement: { type: 'string', description: 'The placement the canvas draws for the card, where it has one.' },
      duplicates: { type: 'list', description: 'Placements of the card the drawn one outranks, to remove.' },
      create: {
        type: 'boolean',
        description: 'Whether a card with no placement may be given one. False for a style, which needs a position.',
      },
    },
    errors: {
      notPlaced: 'Drag this onto the canvas first — how a card looks is saved with where it sits.',
    },
    steps: [
      { find: { as: 'current', entity: 'Placement', where: { id: { $: 'placement' } } } },
      { check: { condition: { $: 'count(current) > 0 || create != false' }, error: 'notPlaced' } },
      {
        forEach: {
          in: { $: 'duplicates ?? []' },
          as: 'duplicate',
          key: { $: 'duplicate' },
          steps: [{ delete: { entity: 'Placement', id: { $: 'duplicate' } } }],
        },
      },
      {
        update: { entity: 'Placement', id: { $: 'placement' }, fields: { $: 'fields' } },
        when: { $: 'count(current) > 0' },
      },
      {
        create: {
          entity: 'Placement',
          // The card it places as a one-element list: how a to-one is written with the record.
          fields: { $: 'merge(fields, { nodeType: nodeType, node: [node] })' },
          parent: canvasChild('canvas'),
        },
        when: { $: 'count(current) == 0' },
      },
    ],
    returns: {
      from: { $: 'count(current) > 0 ? pick(first(current), keys(fields)) : null' },
      to: { $: 'fields' },
    },
  },

  rankCards: {
    description:
      'Write the ranks that order cards among their siblings in a tree read as arranged, all at once, so the tree never reads a half-written row.',
    params: {
      ranks: {
        type: 'list',
        required: true,
        description: 'Each { placement, rank }: the placement the canvas draws for a card, and its new rank.',
      },
    },
    steps: [
      {
        forEach: {
          in: { $: 'ranks' },
          as: 'entry',
          key: { $: 'entry.placement' },
          steps: [
            { update: { entity: 'Placement', id: { $: 'entry.placement' }, fields: { rank: { $: 'entry.rank' } } } },
          ],
        },
      },
    ],
  },

  clearPlacements: {
    description: 'Take a card off a canvas: every placement it has there, so no duplicate puts it back.',
    params: { placements: { type: 'list', required: true, description: 'The placements’ ids.' } },
    steps: [
      {
        forEach: {
          in: { $: 'placements' },
          as: 'placement',
          key: { $: 'placement' },
          steps: [{ delete: { entity: 'Placement', id: { $: 'placement' } } }],
        },
      },
    ],
  },

  writeEdgeRoute: {
    description:
      'Write how a connection is drawn on one canvas — its pinned sides and its bends — editing the route, replacing it, making one, or deleting one that says nothing any more.',
    params: {
      canvas: { type: 'string', required: true, description: 'The canvas.' },
      connection: CONNECTION,
      route: { type: 'string', description: 'The connection’s route on this canvas, where it has one.' },
      action: { type: 'string', required: true, description: 'update, replace, create or delete.' },
      fields: { type: 'object', description: 'sourceAnchor, targetAnchor, points — what the route says.' },
    },
    steps: [
      {
        update: { entity: 'EdgeRoute', id: { $: 'route' }, fields: { $: 'fields ?? {}' } },
        when: { $: "action == 'update' && route" },
      },
      {
        delete: { entity: 'EdgeRoute', id: { $: 'route' } },
        when: { $: "(action == 'replace' || action == 'delete') && route" },
      },
      {
        create: {
          entity: 'EdgeRoute',
          fields: { $: 'merge(fields ?? {}, { connection: [connection] })' },
          parent: canvasChild('canvas'),
        },
        when: { $: "action == 'replace' || action == 'create'" },
      },
    ],
  },

  connectRecords: {
    description:
      'Connect two records with a Relationship — of a community-named kind where one is given — and answer with its id.',
    params: {
      source: { type: 'string', required: true, description: 'The record the connection runs from.' },
      sourceType: { type: 'string', description: 'Its entity.' },
      target: { type: 'string', required: true, description: 'The record it runs to.' },
      targetType: { type: 'string', description: 'Its entity.' },
      key: { type: 'string', description: 'The connection’s dedup key, from both ends’ titles and its label.' },
      kind: { type: 'string', description: 'The RelationshipType it is one of.' },
      fields: { type: 'object', description: 'Anything else it says — a label, a description.' },
      home: { type: 'string', description: 'A collection to make it inside.' },
      inline: INLINE_PARAM,
    },
    steps: [
      // First, so `inlineRecordId` names what it makes, and they exist before the connection points at them.
      { call: { operation: 'core.createRecords', args: { records: { $: 'inline ?? []' } } } },
      {
        create: {
          as: 'housed',
          entity: 'Relationship',
          fields: {
            $: 'merge(fields ?? {}, { sourceType: sourceType, targetType: targetType, connection: key, relationshipTypeId: kind, source: [source], target: [target] })',
          },
          parent: { id: { $: 'home' }, relation: 'children', entity: 'CollectionBlock' },
        },
        when: { $: 'home' },
      },
      {
        create: {
          as: 'loose',
          entity: 'Relationship',
          fields: {
            $: 'merge(fields ?? {}, { sourceType: sourceType, targetType: targetType, connection: key, relationshipTypeId: kind, source: [source], target: [target] })',
          },
        },
        when: { $: '!home' },
      },
    ],
    returns: { $: '(housed ?? loose).id' },
  },

  retargetConnection: {
    description:
      'Move one end of a connection onto a different record — the claim changes, on every canvas — with its key kept in step with the ends.',
    params: {
      connection: CONNECTION,
      end: { type: 'string', required: true, description: 'source or target.' },
      node: { type: 'string', required: true, description: 'The record the end moves to.' },
      nodeType: { type: 'string', required: true, description: 'Its entity.' },
      key: { type: 'string', description: 'The connection’s key with the end moved.' },
    },
    steps: [
      { find: { as: 'found', entity: 'Relationship', where: { id: { $: 'connection' } }, one: true } },
      {
        update: {
          entity: 'Relationship',
          id: { $: 'connection' },
          fields: {
            $: "merge(end == 'source' ? { sourceType: nodeType, source: [node] } : { targetType: nodeType, target: [node] }, key ? { connection: key } : {})",
          },
        },
      },
    ],
  },

  detachConnection: {
    description:
      'Delete a connection nobody has said anything about. One carrying comments or reactions is refused — select the line itself to remove an argued claim.',
    params: { connection: CONNECTION },
    errors: { discussed: 'People have discussed that connection. Select the line itself to remove it.' },
    steps: [
      { find: { as: 'found', entity: 'Relationship', where: { id: { $: 'connection' } }, one: true } },
      {
        check: {
          condition: { $: 'count(found.responses) == 0 && count(found.signals) == 0' },
          error: 'discussed',
        },
      },
      { delete: { entity: 'Relationship', id: { $: 'connection' } } },
    ],
  },

  rekeyConnection: {
    description: 'Bring a connection’s dedup key back in line with its ends’ titles and its label.',
    params: {
      connection: CONNECTION,
      key: { type: 'string', required: true, description: 'The key as it should read.' },
    },
    steps: [
      { find: { as: 'found', entity: 'Relationship', where: { id: { $: 'connection' } } } },
      {
        update: { entity: 'Relationship', id: { $: 'connection' }, fields: { connection: { $: 'key' } } },
        when: { $: 'count(found) > 0 && first(found).connection != key' },
      },
    ],
  },

  colorCanvasType: {
    description:
      'Colour every card of one kind on a canvas: the canvas’s style for the kind edited, or made where there is none.',
    params: {
      canvas: { type: 'string', required: true, description: 'The canvas.' },
      nodeType: { type: 'string', required: true, description: 'The kind of record.' },
      color: { type: 'string', required: true, description: 'The colour, or the host’s value for none of its own.' },
      create: { type: 'boolean', description: 'Whether to make a style where there is none. False when clearing.' },
    },
    steps: [
      {
        find: {
          as: 'styles',
          entity: 'TypeStyle',
          scope: { anchor: 'CollectionBlock', via: 'children', anchorId: { $: 'canvas' } },
          where: { nodeType: { $: 'nodeType' } },
        },
      },
      {
        update: { entity: 'TypeStyle', id: { $: 'first(styles)' }, fields: { color: { $: 'color' } } },
        when: { $: 'count(styles) > 0' },
      },
      {
        create: {
          entity: 'TypeStyle',
          fields: { nodeType: { $: 'nodeType' }, color: { $: 'color' } },
          parent: canvasChild('canvas'),
        },
        when: { $: 'count(styles) == 0 && create != false' },
      },
    ],
  },

  colorSpaceType: {
    description:
      'Colour one kind of record in the space’s key: its style edited, or made where there is none, and any duplicate removed.',
    params: {
      space: { type: 'string', required: true, description: 'The Space record.' },
      nodeType: { type: 'string', required: true, description: 'The kind of record.' },
      color: { type: 'string', required: true, description: 'The colour.' },
    },
    steps: [
      {
        find: {
          as: 'styles',
          entity: 'TypeStyle',
          scope: { anchor: 'Space', via: 'typeStyles', anchorId: { $: 'space' } },
          where: { nodeType: { $: 'nodeType' } },
        },
      },
      {
        forEach: {
          in: { $: 'slice(styles, 1)' },
          as: 'duplicate',
          steps: [{ delete: { entity: 'TypeStyle', id: { $: 'duplicate' } } }],
        },
      },
      {
        update: { entity: 'TypeStyle', id: { $: 'first(styles)' }, fields: { color: { $: 'color' } } },
        when: { $: 'count(styles) > 0' },
      },
      {
        create: {
          entity: 'TypeStyle',
          fields: { nodeType: { $: 'nodeType' }, color: { $: 'color' } },
          parent: { id: { $: 'space' }, relation: 'typeStyles', entity: 'Space' },
        },
        when: { $: 'count(styles) == 0' },
      },
    ],
  },

  restyleSpaceType: {
    description:
      'Say how the space presents one kind of record, whole: its styles removed and one made holding exactly the fields given — none, where nothing is left to say.',
    params: {
      space: { type: 'string', required: true, description: 'The Space record.' },
      nodeType: { type: 'string', required: true, description: 'The kind of record.' },
      fields: { type: 'object', required: true, description: 'color, display, controls, authoring — what it says.' },
    },
    steps: [
      {
        find: {
          as: 'styles',
          entity: 'TypeStyle',
          scope: { anchor: 'Space', via: 'typeStyles', anchorId: { $: 'space' } },
          where: { nodeType: { $: 'nodeType' } },
        },
      },
      {
        forEach: {
          in: { $: 'styles' },
          as: 'style',
          steps: [{ delete: { entity: 'TypeStyle', id: { $: 'style' } } }],
        },
      },
      {
        create: {
          entity: 'TypeStyle',
          fields: { $: 'merge(fields, { nodeType: nodeType })' },
          parent: { id: { $: 'space' }, relation: 'typeStyles', entity: 'Space' },
        },
        when: { $: 'count(keys(fields)) > 0' },
      },
    ],
  },
};
