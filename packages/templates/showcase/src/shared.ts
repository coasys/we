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
import type { SchemaNode, SchemaProp } from '@we/schema-shared';
import { expr } from '@we/schema-shared';
import {
  composerModal as kitComposerModal,
  field,
  formModal,
  HAS_OFFERED_SIGNAL_TYPES,
  OFFERED_SIGNAL_TYPES,
} from '@we/template-kit';

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
 * A composer modal that writes a composed artifact into this space.
 *
 * A thin wrapper over the kit's `composerModal`, which owns the save handshake — see its docstring
 * for why that handshake is not optional and how it fails when skipped. All this adds is the WE
 * action and its arguments: one call for posts, messages, replies and cards, because they differ
 * only in `kind` and where they anchor.
 */
export function composerModal(opts: {
  /** `$localState` boolean on an ancestor of the *opening button*, not merely of this modal. */
  openLocal: string;
  title: string;
  kind: string;
  /** Id of the node to attach to. Omit for a post, which sits loose in the space. */
  parentId?: SchemaProp;
  /** `we://children` (inside a container) or `we://comment` (a reply). */
  predicate?: string;
  saveLabel?: string;
  /**
   * Handlers run after a successful save, beside the kit's own close — `result` is what `createPost`
   * answered with, the new record's id. How a board arranges the card it just composed.
   */
  onClose?: SchemaProp[];
}): SchemaNode {
  return kitComposerModal({
    openLocal: opts.openLocal,
    title: opts.title,
    saveLabel: opts.saveLabel ?? 'Post',
    ...(opts.onClose && { onClose: opts.onClose }),
    saveAction: {
      $action: 'spaceStore.createPost',
      // `'$arg'` first: `createPost(json, options)`.
      args: [
        { $: 'arg' },
        {
          kind: opts.kind,
          ...(opts.parentId !== undefined && { parentId: opts.parentId }),
          ...(opts.predicate && { predicate: opts.predicate }),
        },
      ],
    },
  });
}

/**
 * A modal that creates a bare named container — a channel, a category, a board column.
 *
 * `record.create` rather than the composer: these have a title and no content, so putting them
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
  /** Where to go once it exists. Receives the new id as `result.id`. */
  navigateTo?: string;
}): SchemaNode {
  return formModal({
    open: { $: `local.${opts.openLocal}` },
    close: { $setLocal: opts.openLocal, value: false },
    title: opts.title,
    size: 'sm',
    localState: {
      name: { type: 'string', initial: '' },
      creating: { type: 'boolean', initial: false },
    },
    children: [field({ name: 'name', label: 'Name', placeholder: opts.placeholder, props: { autofocus: true } })],
    // A precondition rather than a validation rule: a container needs a name, and nothing else
    // about it is judgeable here. See the house form guidance. The in-flight half of what this
    // used to `$or` in by hand is the fragment's now.
    disabled: { $: '!local.name' },
    busyLocal: 'creating',
    submitLabel: 'Create',
    submit: {
      $action: 'record.create',
      args: [
        'CollectionBlock',
        {
          kind: opts.kind,
          mode: MODE.feed,
          type: 'collection',
          title: { $: 'local.name' },
        },
        ...(opts.parentId !== undefined ? [{ parent: { id: opts.parentId, predicate: 'we://children' } }] : []),
      ],
      ...(opts.navigateTo && {
        onSuccess: [{ $action: 'routeStore.navigate', args: [expr`${opts.navigateTo} + result.id`] }],
      }),
    },
  });
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
  /** Offered types nobody has used on this node — what the row is not already showing. */
  const unused = `${OFFERED_SIGNAL_TYPES}.filter(t, !count(filter(${nodeRef}.signals, { signalTypeId: t.id })))`;
  return {
    type: '$if',
    props: {
      condition: { $: HAS_OFFERED_SIGNAL_TYPES },
      then: {
        type: 'Row',
        props: { gap: '400', ay: 'center' },
        /*
          Per row, because the node is inside an `$each` and `$localState` there is created per
          mount — so "show me the rest" is about *this* message and closes again when the feed
          re-renders, which is the right lifetime for a control somebody opened to use once.
        */
        $localState: { showAllSignals: { type: 'boolean', initial: false } },
        children: [
          {
            type: '$each',
            props: { items: { $: OFFERED_SIGNAL_TYPES }, as: 'sig' },
            children: [
              {
                /*
                  Only the signals somebody actually gave — until the plus is pressed.

                  A control per defined type on every row — "0" beside a heart, "0" beside a compass,
                  all the way down a channel — is a lot of furniture asserting nothing, and it roughly
                  doubled the height of a one-line message. Every chat client hides an empty reaction
                  for the same reason.

                  The cost used to be that a *first* reaction could not be given from a feed at all:
                  with nothing to react to there was no control to react with, so a type a community
                  had just defined was unreachable from every row in the space. The note here called
                  for hover to solve it, which props cannot express — `hoverProps` answers for the
                  element it is on, and there is no way to say "when my ancestor is hovered". A press
                  says the same thing, works on a touchscreen, and needs nothing from the design
                  system: see the button below.
                */
                type: '$if',
                props: {
                  condition: {
                    $: `local.showAllSignals || count(filter(${nodeRef}.signals, { signalTypeId: sig.id }))`,
                  },
                  then: {
                    type: 'SignalControl',
                    props: {
                      signalType: { $: 'sig' },
                      signals: { $: `filter(${nodeRef}.signals, { signalTypeId: sig.id })` },
                      myDid: { $: 'me.did' },
                      onSignal: {
                        $action: 'spaceStore.upsertSignal',
                        args: [{ $: `${nodeRef}.id` }, { $: 'sig.id' }, { $: 'arg' }],
                      },
                    },
                  },
                },
              },
            ],
          },
          /*
            The way in to a reaction nobody here has given yet.

            Only while there is one to reveal, so a row already showing every type the community
            offers does not carry a button that would change nothing — and it disappears once
            pressed, since what it opens is the rest of the row.
          */
          {
            type: '$if',
            props: {
              condition: { $: `!local.showAllSignals && count(${unused})` },
              then: {
                type: 'we-tooltip',
                props: { content: 'React' },
                children: [
                  {
                    type: 'we-button',
                    props: {
                      variant: 'ghost',
                      size: 'sm',
                      square: true,
                      label: 'React',
                      onClick: { $setLocal: 'showAllSignals', value: true },
                    },
                    children: [{ type: 'we-icon', props: { name: 'smiley' } }],
                  },
                ],
              },
            },
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
 * `Expression: local.signalTypes is not declared` line in the console to say so.
 *
 * One declaration per route, not per row: hoisting is what stops a feed of thirty posts opening
 * thirty identical subscriptions, and it is what keeps the like-count projection and the controls
 * below it agreeing about which type a slug names.
 */
export const signalTypesQuery = { signalTypes: { entity: 'SignalType', subscribe: true } };
