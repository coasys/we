import type { SchemaNode } from '@we/schema-shared';

import { cardShell, gridWrapper } from './CardShell.ts';
import { postComposerModal } from './PostComposerModal.ts';

export const postsList: SchemaNode = {
  type: 'Column',
  props: { gap: '0', width: '100%' },
  $queries: {
    signalTypes: { entity: 'SignalType', subscribe: true },
  },
  children: [
    gridWrapper([
      {
        type: '$each',
        props: {
          items: {
            $query: {
              entity: 'CollectionBlock',
              where: { type: 'root', textContent: { contains: { $local: 'searchText' } } },
              limit: 20,
              order: {
                $if: {
                  condition: { $eq: [{ $local: 'sortField' }, 'likes'] },
                  then: { $likeCount: { $local: 'sortDirection' } },
                  else: { createdAt: { $local: 'sortDirection' } },
                },
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
                    signalTypeId: {
                      $find: { items: { $local: 'signalTypes' }, where: { slug: 'like' }, select: 'id' },
                    },
                  },
                  count: true,
                },
              },
            },
          },
          as: 'post',
        },
        children: [
          cardShell({
            // Both of these drive controls in `header`, so the card is the nearest node that can
            // declare them. Undeclared, `$setLocal` warned and no-opped — the edit and delete
            // buttons rendered, took the click, and did nothing.
            localState: {
              confirmDeleteOpen: { type: 'boolean', initial: false },
              editPostOpen: { type: 'boolean', initial: false },
            },
            header: [
              {
                type: 'Row',
                props: { ax: 'between', ay: 'center', width: '100%' },
                $localState: {
                  confirmDeleteOpen: { type: 'boolean', initial: false },
                  editPostOpen: { type: 'boolean', initial: false },
                },
                children: [
                  {
                    type: '$agent',
                    props: { did: '$post.author', as: 'author' },
                    children: [
                      {
                        type: 'Row',
                        props: { ay: 'center', gap: '300' },
                        children: [
                          {
                            type: 'we-avatar',
                            props: {
                              size: 'sm',
                              image: '$author.avatar',
                              hash: '$author.did',
                            },
                          },
                          {
                            type: 'we-text',
                            props: { fontWeight: 'semibold' },
                            children: ['$author.name'],
                          },
                          {
                            type: 'we-timestamp',
                            props: { value: '$post.createdAt', relative: true, color: 'neutral-500' },
                          },
                        ],
                      },
                    ],
                  },
                  {
                    type: '$if',
                    props: {
                      condition: { $eq: ['$post.author', '$me.did'] },
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
                              onClick: { $setLocal: 'editPostOpen', value: true },
                            },
                            children: [{ type: 'we-icon', props: { name: 'pencil-simple' } }],
                          },
                          {
                            type: '$if',
                            props: {
                              condition: { $local: 'editPostOpen' },
                              then: postComposerModal({
                                title: 'Edit Post',
                                openLocal: 'editPostOpen',
                                editorState: '$post.editorState',
                                saveAction: { $action: 'spaceStore.updatePost', args: ['$post.id'] },
                                saveLabel: 'Save',
                              }),
                            },
                          },
                          {
                            type: 'we-button',
                            props: {
                              variant: 'ghost',
                              size: 'sm',
                              square: true,
                              onClick: { $setLocal: 'confirmDeleteOpen', value: true },
                            },
                            children: [{ type: 'we-icon', props: { name: 'trash' } }],
                          },
                          {
                            type: '$if',
                            props: {
                              condition: { $local: 'confirmDeleteOpen' },
                              then: {
                                type: 'we-modal',
                                props: { close: { $setLocal: 'confirmDeleteOpen', value: false } },
                                children: [
                                  { type: 'we-text', props: { fontWeight: 'semibold' }, children: ['Delete post?'] },
                                  {
                                    type: 'we-text',
                                    children: [
                                      'This will permanently delete the post and everything inside it. This cannot be undone.',
                                    ],
                                  },
                                  {
                                    type: 'Row',
                                    props: { ax: 'end', gap: '200' },
                                    children: [
                                      {
                                        type: 'we-button',
                                        props: {
                                          variant: 'ghost',
                                          onClick: { $setLocal: 'confirmDeleteOpen', value: false },
                                        },
                                        children: ['Cancel'],
                                      },
                                      {
                                        type: 'we-button',
                                        props: {
                                          variant: 'danger',
                                          onClick: {
                                            $action: 'spaceStore.deleteCollection',
                                            args: ['$post.id'],
                                            onSuccess: [{ $setLocal: 'confirmDeleteOpen', value: false }],
                                          },
                                        },
                                        children: ['Delete'],
                                      },
                                    ],
                                  },
                                ],
                              },
                            },
                          },
                        ],
                      },
                    },
                  },
                ],
              },
            ],
            body: [
              {
                type: 'BlockRenderer',
                props: {
                  editorState: '$post.editorState',
                  perspective: { $store: 'datasetStore.currentDataset.handle' },
                },
              },
              {
                type: '$if',
                props: {
                  condition: { $count: { items: { $local: 'signalTypes' } } },
                  then: {
                    type: 'Row',
                    props: { height: '40px', mt: '200', ay: 'center', gap: '700' },
                    children: [
                      {
                        type: '$each',
                        props: { items: { $local: 'signalTypes' }, as: 'sig' },
                        children: [
                          {
                            type: 'SignalControl',
                            props: {
                              signalType: '$sig',
                              signals: {
                                $filter: { items: '$post.signals', where: { signalTypeId: '$sig.id' } },
                              },
                              myDid: '$me.did',
                              onSignal: {
                                $action: 'spaceStore.upsertSignal',
                                args: ['$post.id', '$sig.id', '$arg'],
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
      },
    ]),
  ],
};
