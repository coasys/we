/**
 * Pieces the showcase templates share.
 *
 * Kept here rather than in `@we/template-kit` because they are *these templates'* decisions, not
 * reusable vocabulary: the kit's threshold is three real uses of a shape that a template outside
 * this package would also want, and a "compose a message" modal wired to `spaceStore.createPost`
 * with a fixed kind is a decision about how this demo works. Promoting it would put a showcase's
 * choices into the shared vocabulary, which is how a kit becomes a framework.
 *
 * The one thing worth stating up front, since all six templates lean on it: **none of these mint a
 * content model.** Every container below is a `CollectionBlock` with a `kind` label this package
 * invented and nothing else has to know about, and a `mode` saying who owns its children. A channel
 * is `kind: 'channel', mode: 'feed'`. That is the whole extension mechanism.
 */
import type { SchemaNode } from '@we/schema-shared';

/**
 * The kinds these templates use.
 *
 * Free labels, registered nowhere — a template invents what it needs and queries `where: { kind }`.
 * Collected in one object purely so a typo is a compile error inside this package rather than a
 * feed that silently returns nothing.
 */
export const KIND = {
  /** A channel of messages. Feed: many agents append. */
  channel: 'channel',
  /** A group of channels. Feed. */
  category: 'category',
  /** One utterance in a channel. Document: one agent composed it. */
  message: 'message',
  /** A composed post. Document. */
  post: 'post',
  /** A response, hung off any node through `we://comment`. Document. */
  reply: 'reply',
  /** A kanban board holding columns. Feed. */
  board: 'board',
  /** One column of a board; a card's column is its status. Feed. */
  column: 'column',
  /** An ordered selection of media. Feed. */
  playlist: 'playlist',
  /** An event with an RSVP roster. Document — one organiser wrote it. */
  event: 'event',
} as const;

/** Modes, matching `CollectionMode` in `@we/block-shared` without importing the block system. */
export const MODE = { document: 'document', feed: 'feed' } as const;

/**
 * A composer in a modal, saving through `spaceStore.createPost`.
 *
 * One fragment for posts, messages, replies and cards, because they differ only in `kind` and where
 * they anchor — the composer, the blob, the search index and the mention edges are identical. That
 * equivalence is the substrate's claim made concrete: if a reply needed its own composer, replies
 * would not really be compositions.
 *
 * ## The save handshake, which is not optional
 *
 * `BlockComposer.onSave` does **not** fire when the user types, or when the modal closes. It fires
 * when somebody calls the composer's own `save()`, which it hands out once through `onReady`. So the
 * wiring is: `onReady` stores that function in a `function`-typed local, the button calls it with
 * `$callLocal`, and the action runs *inside* `onSave` with the serialized tree as `$arg`.
 *
 * Written the obvious way instead — button calls the action with a `draft` local the composer was
 * expected to have filled in — it type-checks, validates, renders, and posts `null`, which surfaces
 * as `Cannot read properties of null (reading 'type')` from deep inside `persistNode`. Nothing about
 * the failure points at the missing handshake.
 */
export function composerModal(opts: {
  /** `$localState` boolean on an ancestor of the *opening button*, not merely of this modal. */
  openLocal: string;
  title: string;
  kind: string;
  /** Id of the node to attach to. Omit for a post, which sits loose in the space. */
  parentId?: unknown;
  /** `we://children` (inside a container) or `we://comment` (a reply). */
  predicate?: string;
  saveLabel?: string;
}): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $local: opts.openLocal },
      then: {
        type: 'we-modal',
        props: {
          close: { $setLocal: opts.openLocal, value: false },
          maxWidth: 'var(--we-layout-md)',
          width: '100%',
          ax: 'center',
        },
        $localState: {
          // The composer's own `save()`, handed over by `onReady`. A `function` field, which is
          // what `$callLocal` reads.
          savePost: { type: 'function', initial: null },
          submitting: { type: 'boolean', initial: false },
        },
        children: [
          { type: 'we-text', props: { variant: 'heading-md' }, children: [opts.title] },
          {
            type: 'Column',
            props: { width: '100%', bg: 'neutral-25', p: '600', r: '400', overflow: 'auto' },
            children: [
              {
                type: 'BlockComposer',
                props: {
                  perspective: { $store: 'datasetStore.currentDataset.handle' },
                  onReady: { $setLocal: 'savePost', from: '$event.save' },
                  onSave: [
                    { $setLocal: 'submitting', value: true },
                    {
                      $action: 'spaceStore.createPost',
                      // `$arg` is the serialized tree the composer just produced, and it goes
                      // first: `createPost(json, options)`.
                      args: [
                        '$arg',
                        {
                          kind: opts.kind,
                          ...(opts.parentId !== undefined && { parentId: opts.parentId }),
                          ...(opts.predicate && { predicate: opts.predicate }),
                        },
                      ],
                      onSuccess: [{ $setLocal: opts.openLocal, value: false }],
                      onFinally: [{ $setLocal: 'submitting', value: false }],
                    },
                  ],
                },
              },
            ],
          },
          {
            type: 'Row',
            props: { ax: 'end', gap: '300', mt: '200', width: '100%' },
            children: [
              {
                type: 'we-button',
                props: { variant: 'ghost', onClick: { $setLocal: opts.openLocal, value: false } },
                children: ['Cancel'],
              },
              {
                type: 'we-button',
                props: {
                  variant: 'primary',
                  loading: { $local: 'submitting' },
                  // Disabled only while in flight, never on "nothing typed yet" — the house rule,
                  // and nothing about a draft is locally judgeable anyway.
                  disabled: { $local: 'submitting' },
                  onClick: { $callLocal: 'savePost' },
                },
                children: [opts.saveLabel ?? 'Post'],
              },
            ],
          },
        ],
      },
    },
  };
}

/**
 * A modal that creates a bare named container — a channel, a category, a board column.
 *
 * `model.create` rather than the composer: these have a title and no content, so putting them
 * through a block editor would ask for a document nobody wants to write. `mode` is written here
 * because that is the whole reason feed containers are safe — see the reconcile guard.
 */
export function newContainerModal(opts: {
  openLocal: string;
  title: string;
  kind: string;
  placeholder: string;
  /** Attach inside another container — a channel inside a category. */
  parentId?: unknown;
  /** Where to go once it exists. Receives the new id as `$result.id`. */
  navigateTo?: string;
}): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $local: opts.openLocal },
      then: {
        type: 'we-modal',
        props: { close: { $setLocal: opts.openLocal, value: false } },
        $localState: {
          name: { type: 'string', initial: '' },
          creating: { type: 'boolean', initial: false },
        },
        children: [
          {
            type: 'Column',
            props: { gap: '400', p: '400', width: '100%' },
            children: [
              { type: 'we-text', props: { variant: 'heading-md' }, children: [opts.title] },
              {
                type: 'we-form-field',
                props: { label: 'Name' },
                children: [
                  {
                    type: 'we-input',
                    props: {
                      placeholder: opts.placeholder,
                      autofocus: true,
                      value: { $local: 'name' },
                      onInput: { $setLocal: 'name', from: '$event.detail' },
                    },
                  },
                ],
              },
              {
                type: 'Row',
                props: { ax: 'end', gap: '200', width: '100%' },
                children: [
                  {
                    type: 'we-button',
                    props: { variant: 'ghost', onClick: { $setLocal: opts.openLocal, value: false } },
                    children: ['Cancel'],
                  },
                  {
                    type: 'we-button',
                    props: {
                      variant: 'primary',
                      loading: { $local: 'creating' },
                      // A precondition rather than a validation rule: a container needs a name, and
                      // nothing else about it is judgeable here. See the house form guidance.
                      disabled: { $or: [{ $not: { $local: 'name' } }, { $local: 'creating' }] },
                      onClick: [
                        { $setLocal: 'creating', value: true },
                        {
                          $action: 'model.create',
                          args: [
                            'CollectionBlock',
                            {
                              kind: opts.kind,
                              mode: MODE.feed,
                              type: 'collection',
                              title: { $local: 'name' },
                            },
                            ...(opts.parentId !== undefined
                              ? [{ parent: { id: opts.parentId, predicate: 'we://children' } }]
                              : []),
                          ],
                          onSuccess: [
                            { $setLocal: opts.openLocal, value: false },
                            ...(opts.navigateTo
                              ? [
                                  {
                                    $action: 'routeStore.navigate',
                                    args: [{ $concat: [opts.navigateTo, '$result.id'] }],
                                  },
                                ]
                              : []),
                          ],
                          onFinally: [{ $setLocal: 'creating', value: false }],
                        },
                      ],
                    },
                    children: ['Create'],
                  },
                ],
              },
            ],
          },
        ],
      },
    },
  };
}

/**
 * The signal controls a community has defined, rendered for one node.
 *
 * Every one of these templates reads its reactions this way rather than hardcoding a "like": a
 * signal type is created per space, so what a heart *means* here is the community's decision and
 * not the template's. It is the clearest single demonstration of the pitch, and it costs one
 * hoisted query.
 *
 * Renders nothing until the space has defined a type, which is correct — a space with no signal
 * types has not decided what reacting means, and inventing one on its behalf would be the exact
 * imposition the design refuses.
 */
export function signalRow(nodeRef: string): SchemaNode {
  return {
    type: '$if',
    props: {
      condition: { $count: { items: { $local: 'signalTypes' } } },
      then: {
        type: 'Row',
        props: { gap: '400', ay: 'center' },
        children: [
          {
            type: '$each',
            props: { items: { $local: 'signalTypes' }, as: 'sig' },
            children: [
              {
                type: 'SignalControl',
                props: {
                  signalType: '$sig',
                  signals: { $filter: { items: `${nodeRef}.signals`, where: { signalTypeId: '$sig.id' } } },
                  myDid: '$me.did',
                  onSignal: { $action: 'spaceStore.upsertSignal', args: [`${nodeRef}.id`, '$sig.id', '$arg'] },
                },
              },
            ],
          },
        ],
      },
    },
  };
}

/**
 * The hoisted subscription `signalRow` reads.
 *
 * **Declare it inside the route that uses it, never only on the template root.** A route subtree is
 * rendered by `buildRoutes` through a fresh `RenderSchema` call, so it inherits *no* context from
 * the template root — `$queries` and `$localState` declared up there are invisible below a
 * `$routes` outlet. Getting this wrong is quiet in the worst way: the reads resolve to nothing, the
 * `$count` guard reads falsy, and the signal controls simply never appear, with only a
 * `Schema $local: field "signalTypes" not declared` line in the console to say so.
 *
 * One declaration per route, not per row: hoisting is what stops a feed of thirty posts opening
 * thirty identical subscriptions, and it is what keeps the like-count projection and the controls
 * below it agreeing about which type a slug names.
 */
export const signalTypesQuery = { signalTypes: { entity: 'SignalType', subscribe: true } };
