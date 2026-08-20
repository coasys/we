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

export const edgeDetailModal: SchemaNode = {
  type: '$if',
  props: {
    condition: EDGE_ID,
    then: {
      type: 'we-modal',
      props: { close, maxWidth: 'var(--we-layout-sm)', width: '100%' },
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
                    { type: 'we-icon', props: { name: 'arrow-right', size: 'xs', color: 'neutral-400' } },
                    { type: 'we-badge', props: { size: 'xs' }, children: ['$link.targetType'] },
                  ],
                },
                { type: 'we-text', props: { variant: 'heading-md' }, children: ['$link.label'] },
                {
                  type: '$if',
                  props: {
                    condition: '$link.description',
                    then: { type: 'we-text', props: { color: 'neutral-600' }, children: ['$link.description'] },
                  },
                },
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
                        color: 'danger-600',
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
