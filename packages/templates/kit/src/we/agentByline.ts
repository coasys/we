import type { SchemaNode, SchemaProp } from '@we/schema-shared';

export interface AgentBylineOptions {
  /** The DID to look up — usually a record's `author` field. */
  did: SchemaProp;
  /**
   * Context key the resolved profile is bound to. Must not collide with an outer `$each` or a
   * surrounding `$agent`, which is why it is worth naming per call site rather than defaulting
   * everywhere to `author`.
   */
  as?: string;
  avatarSize?: string;
  /**
   * One step down — the face, the name and the time, for a byline inside something dense.
   *
   * A thread is the case it was added for: a reply's byline sits above two lines of text and under
   * another reply, so at a post's weight it competes with the words it introduces. `avatarSize`
   * still wins where a caller names one, since the two are not always wanted together.
   *
   * It shortens the time as well as the type: "3h", not "3 hours ago". Dense is about words as much
   * as points — the same reason the transcript writes a clock rather than a sentence on every line —
   * and a byline compact enough to want an xs face does not want a clause after the name.
   */
  compact?: boolean;
  /** When this was written. Shown relative, because that is what a reader wants from a byline. */
  timestamp?: SchemaProp;
  /** Stack the name above the timestamp rather than running them along one line. */
  stacked?: boolean;
  nameColor?: string;
  /** Anything after the name — a badge, a menu, a role. */
  children?: SchemaNode[];
}

/**
 * Who wrote this, with their picture: the line at the top of a post, a message, an utterance.
 *
 * `$agent` is the reason this has to be a fragment rather than a component — resolving a DID to a
 * profile is schema machinery, and a registered component cannot do it. Everything the fragment
 * draws is otherwise ordinary nodes, so a template wanting the avatar bigger or the timestamp first
 * edits the expansion.
 *
 * The picture is addressed by `hash` as well as `image` so an agent with no avatar still gets a
 * stable identicon rather than an empty circle — the same face every time, which is most of what a
 * byline is for.
 *
 * `avatar`, `name` and `time` are named because both arrangements share them — the `as`
 * interpolation should exist exactly once. See CONVENTIONS.md.
 */
export function agentByline(opts: AgentBylineOptions): SchemaNode {
  const as = opts.as ?? 'author';
  const avatar: SchemaNode = {
    type: 'we-avatar',
    props: {
      flexShrink: '0',
      size: opts.avatarSize ?? (opts.compact ? 'xs' : 'sm'),
      image: { $: `${as}.avatar` },
      hash: { $: `${as}.did` },
    },
  };
  const name: SchemaNode = {
    type: 'we-text',
    props: {
      /*
        Bold everywhere but compact. A byline over a post is a heading for what follows and earns
        the weight; in a thread the same treatment makes every name shout over the sentence under
        it, and there is one per reply.
      */
      ...(opts.compact ? { fontSize: '200' } : { fontWeight: 'semibold' }),
      ...(opts.nameColor && { color: opts.nameColor }),
      /*
        A name is one word and keeps its width.

        Typography here defaults to `overflow-wrap: anywhere`, which is right for a URL or a DID and
        wrong for this: it drops the element's min-content width to a single character, so a row
        short of space breaks the name one letter per line rather than leaving it alone. A byline is
        the most crowded row in the app — face, name, time and a pair of controls, inside a panel —
        so it is where that shows.

        Opting out of that is necessary and not sufficient: freed from breaking mid-word the name
        still wraps BETWEEN words, because the row really is short of space. So the name is the one
        thing in the byline allowed to give, and it gives by being cut rather than by folding.

        The earlier attempt did half of this — it let the row shrink without saying which child
        absorbed it, so everything collapsed at once and the controls rode up over the face. What
        makes it safe is the other half: every other item in the row refuses to shrink, so there is
        exactly one place for the deficit to land.
      */
      overflowWrap: 'normal',
      whiteSpace: 'nowrap',
      truncate: true,
      minWidth: '0',
    },
    children: [{ $: `${as}.name` }],
  };
  const time: SchemaNode[] =
    opts.timestamp !== undefined
      ? [
          {
            type: 'we-timestamp',
            props: {
              // Never shrinks: a time is short and fixed, so letting it give would only move the
              // deficit somewhere that cannot absorb it.
              flexShrink: '0',
              whiteSpace: 'nowrap',
              value: opts.timestamp,
              relative: true,
              color: 'text-muted',
              ...(opts.compact && { fontSize: '200', relativeStyle: 'narrow' }),
            },
          },
        ]
      : [];

  return {
    type: '$agent',
    props: { did: opts.did, as },
    children: [
      opts.stacked
        ? {
            type: 'Row',
            props: { gap: '300', ay: 'start' },
            children: [
              avatar,
              {
                type: 'Column',
                props: { gap: '100' },
                children: [
                  { type: 'Row', props: { ay: 'center', gap: '200' }, children: [name, ...time] },
                  ...(opts.children ?? []),
                ],
              },
            ],
          }
        : {
            type: 'Row',
            // Closer together when compact: at `300` the face, the name and the time read as three
            // things on a line rather than one byline.
            // `minWidth: 0` so the row may be asked to be narrower than its content, which is what
            // lets the name inside it be cut. Without it a flex item is never asked, and the
            // ellipsis never arrives.
            props: { ay: 'center', gap: opts.compact ? '200' : '300', minWidth: '0' },
            children: [avatar, name, ...time, ...(opts.children ?? [])],
          },
    ],
  };
}
