import type { SchemaNode } from '@we/schema-shared';
import { agentByline, commentThread, composerModal } from '@we/template-kit';

/**
 * A drawn connection, opened.
 *
 * The reason `Relationship` is an entity rather than a link is that a claim two things are related
 * is exactly the kind of claim people argue about — and this is where the arguing happens. Reading
 * it back has to offer everything a `WeNode` carries: who said it, what they said, what the
 * community thinks of it, and the thread underneath.
 *
 * ## Why a modal and not the strip
 *
 * A clicked *node* gets the strip along the bottom, which is right: it names one thing and gets out
 * of the way, because the map is what you are looking at. A connection is the opposite — you clicked
 * it to find out what somebody meant by it — and a thread cannot live in a bar one line tall.
 *
 * ## Why it queries rather than reading the edge
 *
 * `onEdgeClick` hands over the *drawn* edge: its label and its scalars, which the expander flattened
 * out of the record. That is everything the map needed and none of what a discussion needs — no
 * comments, no signals, no author. `reifiedAs` keeps the record reachable, which is what it is for,
 * and `$single` fetches the thing itself.
 */

/**
 * The record behind the clicked edge.
 *
 * `onEdgeClick` resolves it out of `reifiedAs` and hands it over as `recordId` — a template has no
 * operator that could take a graph address apart, so the event answers the question it raises.
 * Absent on an ordinary edge, which stands for a declared relation and has no record; the modal's
 * condition is exactly that absence, so clicking one opens nothing.
 */
const EDGE_ID = { $local: 'selectedEdge.recordId' };

const close = { $setLocal: 'selectedEdge', value: null };

/** Rating a connection is rating a WeNode, so it is the same control every other surface uses. */
const signals: SchemaNode = {
  type: '$if',
  props: {
    condition: { $count: { items: { $local: 'signalTypes' } } },
    then: {
      type: 'Row',
      props: { gap: '600', ay: 'center', minHeight: '40px' },
      children: [
        {
          type: '$each',
          props: { items: { $local: 'signalTypes' }, as: 'sig' },
          children: [
            {
              type: 'SignalControl',
              props: {
                signalType: '$sig',
                signals: { $filter: { items: '$link.signals', where: { signalTypeId: '$sig.id' } } },
                myDid: '$me.did',
                onSignal: { $action: 'spaceStore.upsertSignal', args: ['$link.id', '$sig.id', '$arg'] },
              },
            },
          ],
        },
      ],
    },
  },
};

/**
 * The thread.
 *
 * Deliberately the same fragment a post's replies use, anchored to the relationship instead. A
 * connection is a `WeNode`, so it is commentable by construction — the point of modelling it that
 * way was that none of this had to be built twice.
 */
const thread: SchemaNode = commentThread({
  anchorId: '$link.id',
  reply: (as) => [
    {
      type: 'Column',
      props: { gap: '100', width: '100%', py: '200' },
      children: [
        agentByline({ did: `$${as}.author`, timestamp: `$${as}.createdAt` }),
        { type: 'BlockRenderer', props: { editorState: `$${as}.editorState` } },
      ],
    },
  ],
});

/**
 * The claim itself, editable.
 *
 * A connection is somebody's words about a pair, and words get revised — a line drawn "blocks" when
 * it turns out to be "depends on" is the ordinary case, and until now the only way to fix one was to
 * delete it and draw it again, which discards the thread and the ratings underneath it. That is the
 * argument for editing rather than re-drawing: what is being corrected is the wording of a claim,
 * not the claim's existence.
 *
 * Editing in place rather than in a second modal. The heading *is* the label, so replacing it with a
 * field is the smallest thing that can happen — and everything below stays on screen, which matters
 * when what you are rewording is being discussed right underneath.
 *
 * The draft seeds from the record and is thrown away on cancel, so nothing is written until Save.
 * Open to everyone for the reason Remove is: a neighbourhood is writable by every member, and the
 * edit is authored.
 */
const editing: SchemaNode = {
  type: 'Column',
  props: { gap: '300', width: '100%' },
  /*
    Seeded from the record, which is why this is declared inside `$single` rather than on the modal:
    `$link` does not exist further out, and an initial that resolved to nothing would silently make
    every edit start from a blank field.
  */
  $localState: {
    editOpen: { type: 'boolean', initial: false },
    draftLabel: { type: 'string', initial: '$link.label' },
    draftDescription: { type: 'string', initial: '$link.description' },
    draftKind: { type: 'string', initial: '$link.relationshipTypeId' },
  },
  children: [
    {
      type: '$if',
      props: {
        condition: { $local: 'editOpen' },
        else: {
          type: 'Row',
          props: { gap: '200', ay: 'center', width: '100%' },
          children: [
            { type: 'we-text', props: { variant: 'heading-md' }, children: ['$link.label'] },
            {
              type: 'we-button',
              props: {
                size: 'xs',
                variant: 'ghost',
                ml: 'auto',
                title: 'Edit',
                onClick: { $setLocal: 'editOpen', value: true },
              },
              children: [{ type: 'we-icon', props: { name: 'pencil-simple' } }],
            },
          ],
        },
        then: {
          type: 'Column',
          props: { gap: '300', width: '100%' },
          children: [
            {
              type: 'we-form-field',
              props: { label: 'Says', size: 'sm', width: '100%' },
              children: [
                {
                  type: 'we-input',
                  props: {
                    width: '100%',
                    placeholder: 'contradicts, depends on, inspired by…',
                    value: { $local: 'draftLabel' },
                    onInput: { $setLocal: 'draftLabel', from: '$event.detail' },
                  },
                },
              ],
            },
            {
              type: 'we-form-field',
              props: { label: 'Why', size: 'sm', width: '100%' },
              children: [
                {
                  type: 'we-textarea',
                  props: {
                    width: '100%',
                    rows: 2,
                    placeholder: 'What makes this true? (optional)',
                    value: { $local: 'draftDescription' },
                    onInput: { $setLocal: 'draftDescription', from: '$event.detail' },
                  },
                },
              ],
            },
            /*
              The kind, where the community has named any.

              Changing it is a real edit rather than a cosmetic one: the kind is what the maps colour
              and arrow by, so this is how a line drawn as a free-text label gets promoted into the
              vocabulary the space actually uses.
            */
            {
              type: '$if',
              props: {
                condition: { $count: { items: { $local: 'relationshipKinds' } } },
                then: {
                  type: 'we-form-field',
                  props: { label: 'Kind', size: 'sm', width: '100%' },
                  children: [
                    {
                      type: 'we-select',
                      props: {
                        size: 'sm',
                        width: '100%',
                        placeholder: 'No particular kind',
                        value: { $local: 'draftKind' },
                        options: {
                          $map: {
                            items: { $local: 'relationshipKinds' },
                            select: { label: '$item.name', value: '$item.id' },
                          },
                        },
                        onChange: { $setLocal: 'draftKind', from: '$event.detail' },
                      },
                    },
                  ],
                },
              },
            },
            {
              type: 'Row',
              props: { gap: '300', ax: 'end', width: '100%' },
              children: [
                {
                  type: 'we-button',
                  props: {
                    size: 'sm',
                    variant: 'ghost',
                    // Resets the draft as well as closing: reopening after a cancel must start from
                    // the record again rather than from the words somebody decided against.
                    onClick: [{ $resetLocal: '$scope' }],
                  },
                  children: ['Cancel'],
                },
                {
                  type: 'we-button',
                  props: {
                    size: 'sm',
                    variant: 'primary',
                    // Nothing about a label is locally judgeable beyond its presence.
                    disabled: { $not: { $local: 'draftLabel' } },
                    onClick: {
                      $action: 'model.update',
                      args: [
                        'Relationship',
                        '$link.id',
                        {
                          label: { $local: 'draftLabel' },
                          description: { $local: 'draftDescription' },
                          relationshipTypeId: { $local: 'draftKind' },
                        },
                      ],
                      // The graph re-reads, so the line's label and its colour change with it.
                      onSuccess: [
                        { $setLocal: 'editOpen', value: false },
                        { $setLocal: 'revision', by: 1 },
                      ],
                    },
                  },
                  children: ['Save'],
                },
              ],
            },
          ],
        },
      },
    },
    {
      type: '$if',
      props: {
        condition: { $and: ['$link.description', { $not: { $local: 'editOpen' } }] },
        then: { type: 'we-text', props: { color: 'text-muted' }, children: ['$link.description'] },
      },
    },
  ],
};

export const edgeDetailModal: SchemaNode = {
  type: '$if',
  props: {
    condition: EDGE_ID,
    then: {
      type: 'we-modal',
      props: { size: 'md', close },
      // Hoisted so the projection and the controls agree about what a slug means — the house rule
      // for signal types, which have no store accessor by design.
      $queries: { signalTypes: { entity: 'SignalType', subscribe: true } },
      $localState: { replyOpen: { type: 'boolean', initial: false } },
      children: [
        {
          type: '$single',
          props: {
            item: { $query: { entity: 'Relationship', where: { id: EDGE_ID }, include: { signals: true } } },
            as: 'link',
          },
          children: [
            {
              type: 'Column',
              props: { gap: '400', width: '100%' },
              children: [
                {
                  type: 'Row',
                  props: { gap: '200', ay: 'center', wrap: true, width: '100%' },
                  children: [
                    { type: 'we-badge', props: { size: 'xs' }, children: ['$link.sourceType'] },
                    { type: 'we-icon', props: { name: 'arrow-right', size: 'xs', color: 'text-faint' } },
                    { type: 'we-badge', props: { size: 'xs' }, children: ['$link.targetType'] },
                  ],
                },
                editing,
                agentByline({ did: '$link.author', timestamp: '$link.createdAt' }),
                signals,
                { type: 'we-divider' },
                thread,
                {
                  type: 'Row',
                  props: { gap: '300', width: '100%' },
                  children: [
                    {
                      type: 'we-button',
                      props: { size: 'sm', variant: 'ghost', onClick: { $setLocal: 'replyOpen', value: true } },
                      children: [{ type: 'we-icon', props: { name: 'chat-circle' } }, 'Reply'],
                    },
                    /*
                      Deleting is offered to everybody, not only the author.

                      A neighbourhood is writable by every member, so gating this on authorship would
                      be a suggestion rather than a rule — and the thing being removed is a claim
                      about the community's own records, which the community is entitled to retract.
                      What holds it accountable is that the deletion is itself authored.
                    */
                    {
                      type: 'we-button',
                      props: {
                        size: 'sm',
                        variant: 'ghost',
                        color: 'danger-text',
                        ml: 'auto',
                        onClick: {
                          $action: 'model.delete',
                          args: ['Relationship', '$link.id'],
                          onSuccess: [close, { $setLocal: 'revision', by: 1 }],
                        },
                      },
                      children: [{ type: 'we-icon', props: { name: 'trash' } }, 'Remove'],
                    },
                  ],
                },
                /*
                  A reply is a composed artifact hanging off the connection, which is the same
                  action a reply to a post uses — `we://comment` rather than `we://children`,
                  because it answers the claim rather than becoming part of it.
                */
                composerModal({
                  openLocal: 'replyOpen',
                  title: 'Reply',
                  saveLabel: 'Reply',
                  saveAction: {
                    $action: 'spaceStore.createPost',
                    // `'$arg'` first: `createPost(json, options)`.
                    args: ['$arg', { kind: 'reply', parentId: '$link.id', predicate: 'we://comment' }],
                  },
                }),
              ],
            },
          ],
        },
      ],
    },
  },
};
