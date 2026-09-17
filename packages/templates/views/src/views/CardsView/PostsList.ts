import type { SchemaNode } from '@we/schema-shared';
import {
  agentByline,
  anchorScope,
  cardList,
  cardShell,
  composerModal,
  emptyState,
  HAS_OFFERED_SIGNAL_TYPES,
  OFFERED_SIGNAL_TYPES,
  recordLink,
} from '@we/template-kit';

export const postsList: SchemaNode = {
  type: 'Column',
  props: { gap: '0', width: '100%' },
  $queries: {
    signalTypes: { entity: 'SignalType', subscribe: true },
  },
  children: [
    /*
      The posts query is hoisted by `cardList` onto a node *inside* this one, not merged into the
      `$queries` above. Order matters: a node's `$queries` entries are all resolved against the
      context as it was on entry, so a query declared beside `signalTypes` could not read it — and
      the like-count projection below is written in terms of it.
    */
    /*
      The feed is somewhere to drop things into, not only to drag them out of.

      Whatever lands becomes a post here — a copy of your own note or post, a quote of anybody
      else's — through `recordStore.bringIn`, which holds the rule. `noSelf`: a card picked up in
      this feed is already here, and lighting the feed up for it would promise a drop that does
      nothing.

      It says what a drop does, in a badge at its top while a drag is running: around a feed of one
      post the ring alone is that post's outline, which reads as "drop onto this post".
    */
    {
      type: 'we-drop-zone',
      props: {
        width: '100%',
        noSelf: true,
        hint: 'Drop to post it in this space',
        onDropped: { $action: 'recordStore.bringIn', args: [{ $: 'event.detail' }] },
      },
      children: [
        cardList({
          query: {
            entity: 'CollectionBlock',
            where: { type: 'root', textContent: { contains: { $: 'local.searchText' } } },
            // Space-wide unless the route names an anchor, in which case this is that container's own
            // posts. See `anchorScope` — an unresolved anchor is dropped rather than matching nothing.
            scope: anchorScope(),
            limit: 20,
            order: {
              $: "local.sortField == 'likes' ? { $likeCount: local.sortDirection } : { createdAt: local.sortDirection }",
            },
            include: {
              signals: true,
              $likeCount: {
                from: 'signals',
                /*
                  The `like` signal type, taken from the hoisted query above rather than a store.

                  `spaceStore.signalTypesBySlug` used to serve this and was deleted with AdamStore
                  (`044c88c3`) without a replacement, so this filtered on `undefined` — every post's
                  like count wrong, and sorting by likes with it. Nothing caught it: the route was
                  not being walked, the docs still listed the member, and no `$query` internals were
                  checked.

                  Reading `$local` keeps one source for the space's signal types — the same list the
                  controls below render from — so the count and the buttons can never disagree about
                  which type `like` is.
                */
                where: {
                  signalTypeId: { $: "find(local.signalTypes, { slug: 'like' }).id" },
                },
                count: true,
              },
            },
          },
          as: 'post',
          empty: emptyState({ icon: 'newspaper', label: 'posts', searchable: true }),
          children: [
            cardShell({
              // Every card in this route is a drag source; the list is the only thing that knows what
              // its rows are. See `cardShell`'s `drag`.
              drag: {
                entity: 'CollectionBlock',
                id: { $: 'post.id' },
                label: { $: 'post.textContent' },
                icon: 'newspaper',
                /*
                  The same `editorState` the card body below renders, so the ghost draws the real post
                  rather than a name for it — which is where the picture in a post comes from, there
                  being no thumbnail field on `CollectionBlock` and no need for one.
                */
                preview: {
                  content: { $: 'post.editorState' },
                  author: { $: 'post.author' },
                  date: { $: 'post.createdAt' },
                },
              },
              // Drives the edit control in `header`, so the card is the nearest node that can declare
              // it. Undeclared, `$setLocal` warned and no-opped — the button rendered, took the click,
              // and did nothing.
              localState: {
                editPostOpen: { type: 'boolean', initial: false },
              },
              header: [
                {
                  type: 'Row',
                  props: { ax: 'between', ay: 'center', width: '100%' },
                  $localState: {
                    editPostOpen: { type: 'boolean', initial: false },
                  },
                  children: [
                    agentByline({ did: { $: 'post.author' }, timestamp: { $: 'post.createdAt' } }),
                    // Who has the composer open on this post right now — the `edit` activity peers
                    // publish (see the edit button below). Shown so two people rarely edit the same post
                    // at once; when they do anyway, the save says whose paragraph was kept.
                    {
                      type: '$if',
                      props: {
                        condition: {
                          $: "count(presenceStore.online.filter(p, p.did != me.did && p.activities.exists(a, a.type == 'edit' && a.nodeId == post.id)))",
                        },
                        then: {
                          type: 'we-badge',
                          props: { variant: 'warning', size: 'sm' },
                          children: [
                            {
                              $: "`${presenceStore.online.filter(p, p.did != me.did && p.activities.exists(a, a.type == 'edit' && a.nodeId == post.id)).map(p, p.name).join(', ')} editing`",
                            },
                          ],
                        },
                      },
                    },
                    {
                      type: 'Row',
                      props: { gap: '100', ay: 'center' },
                      children: [
                        // Outside the authorship gate below: opening a record is reading, and everyone
                        // who can see the card can already read it. Gating it would hide the only
                        // address the post has from everyone but its author.
                        recordLink({ $: "'CollectionBlock'" }, { $: 'post.id' }),
                        {
                          type: '$if',
                          props: {
                            condition: { $: 'post.author == me.did' },
                            then: {
                              type: 'Row',
                              props: { gap: '100' },
                              children: [
                                {
                                  type: 'we-button',
                                  props: {
                                    variant: 'ghost',
                                    size: 'sm',
                                    square: true,
                                    // Opening the composer says so to everyone: an `edit` activity on the
                                    // post, which a peer's card shows as "X is editing" (below). The soft
                                    // lock a peer-to-peer store can offer — a refusal it cannot.
                                    onClick: [
                                      { $setLocal: 'editPostOpen', value: true },
                                      {
                                        $action: 'presenceStore.setActivity',
                                        args: [{ type: 'edit', nodeId: { $: 'post.id' } }],
                                      },
                                    ],
                                  },
                                  children: [{ type: 'we-icon', props: { name: 'pencil-simple' } }],
                                },
                                // No `$if` here: the fragment mounts only while `editPostOpen` is set,
                                // which is what resets the composer between edits.
                                composerModal({
                                  title: 'Edit Post',
                                  openLocal: 'editPostOpen',
                                  editorState: { $: 'post.editorState' },
                                  // `'$arg'` second: `updatePost(postId, json)`.
                                  saveAction: {
                                    $action: 'spaceStore.updatePost',
                                    args: [{ $: 'post.id' }, { $: 'arg' }],
                                  },
                                  saveLabel: 'Save',
                                  onClose: [
                                    { $action: 'presenceStore.clearActivity', args: ['edit', { $: 'post.id' }] },
                                  ],
                                }),
                                {
                                  type: 'we-button',
                                  props: {
                                    variant: 'ghost',
                                    size: 'sm',
                                    square: true,
                                    /*
                                      No `confirmModal` here, and none anywhere else on a destructive
                                      store action: the host raises its own in front of every one of
                                      them, from the tier boundary. A second dialog behind it would be
                                      two questions about one click, and this is the one a hostile
                                      template could simply have omitted. See DestructivePrompt.schema.ts.
                                    */
                                    onClick: { $action: 'spaceStore.deleteCollection', args: [{ $: 'post.id' }] },
                                  },
                                  children: [{ type: 'we-icon', props: { name: 'trash' } }],
                                },
                              ],
                            },
                          },
                        },
                      ],
                    },
                  ],
                },
              ],
              body: [
                /*
                  Where the author posted this before — written only when they brought their own post
                  over from another shared space. Somebody else's post is never copied, so this is
                  never a claim about whose words these are. See `CollectionBlock.sourceRef`.
                */
                {
                  type: '$if',
                  props: {
                    condition: { $: 'post.sourceName' },
                    then: {
                      type: 'we-button',
                      props: {
                        variant: 'ghost',
                        size: 'xs',
                        alignSelf: 'start',
                        onClick: { $action: 'spaceStore.openRecordRef', args: [{ $: 'post.sourceRef' }] },
                      },
                      children: [
                        {
                          type: 'Row',
                          props: { gap: '100', ay: 'center' },
                          children: [
                            { type: 'we-icon', props: { name: 'arrows-left-right', size: 'sm', color: 'text-faint' } },
                            {
                              type: 'we-text',
                              props: { variant: 'footnote', color: 'text-muted' },
                              children: [{ $: "'Also posted in ' + post.sourceName" }],
                            },
                          ],
                        },
                      ],
                    },
                  },
                },
                {
                  type: 'BlockRenderer',
                  props: {
                    editorState: { $: 'post.editorState' },
                    // Each block can be taken out on its own — a picture into the Pocket, a paragraph by
                    // its grip — carrying the post it came from.
                    blockDrag: { within: { $: 'post.id' }, author: { $: 'post.author' } },
                  },
                },
                {
                  type: '$if',
                  props: {
                    condition: { $: HAS_OFFERED_SIGNAL_TYPES },
                    then: {
                      type: 'Row',
                      props: { height: '40px', mt: '200', ay: 'center', gap: '700' },
                      children: [
                        {
                          type: '$each',
                          props: { items: { $: OFFERED_SIGNAL_TYPES }, as: 'sig' },
                          children: [
                            {
                              type: 'SignalControl',
                              props: {
                                signalType: { $: 'sig' },
                                signals: { $: 'filter(post.signals, { signalTypeId: sig.id })' },
                                myDid: { $: 'me.did' },
                                onSignal: {
                                  $action: 'spaceStore.upsertSignal',
                                  args: [{ $: 'post.id' }, { $: 'sig.id' }, { $: 'arg' }],
                                },
                              },
                            },
                          ],
                        },
                      ],
                    },
                  },
                },
              ],
            }),
          ],
        }),
      ],
    },
  ],
};
