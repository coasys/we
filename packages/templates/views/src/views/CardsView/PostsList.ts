import type { SchemaNode } from '@we/schema-shared';
import { agentByline, cardList, cardShell, composerModal, confirmModal, emptyState } from '@we/template-kit';

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
    cardList({
      query: {
        entity: 'CollectionBlock',
        where: { type: 'root', textContent: { contains: { $: 'local.searchText' } } },
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
                agentByline({ did: { $: 'post.author' }, timestamp: { $: 'post.createdAt' } }),
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
                            onClick: { $setLocal: 'editPostOpen', value: true },
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
                          saveAction: { $action: 'spaceStore.updatePost', args: [{ $: 'post.id' }, { $: 'arg' }] },
                          saveLabel: 'Save',
                        }),
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
                        confirmModal({
                          open: { $: 'local.confirmDeleteOpen' },
                          close: { $setLocal: 'confirmDeleteOpen', value: false },
                          title: 'Delete post?',
                          body: 'This will permanently delete the post and everything inside it. This cannot be undone.',
                          confirmLabel: 'Delete',
                          confirm: { $action: 'spaceStore.deleteCollection', args: [{ $: 'post.id' }] },
                        }),
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
                editorState: { $: 'post.editorState' },
              },
            },
            {
              type: '$if',
              props: {
                condition: { $: 'count(local.signalTypes)' },
                then: {
                  type: 'Row',
                  props: { height: '40px', mt: '200', ay: 'center', gap: '700' },
                  children: [
                    {
                      type: '$each',
                      props: { items: { $: 'local.signalTypes' }, as: 'sig' },
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
};
