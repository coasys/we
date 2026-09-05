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
    props: { size: opts.avatarSize ?? 'sm', image: { $: `${as}.avatar` }, hash: { $: `${as}.did` } },
  };
  const name: SchemaNode = {
    type: 'we-text',
    props: { fontWeight: 'semibold', ...(opts.nameColor && { color: opts.nameColor }) },
    children: [{ $: `${as}.name` }],
  };
  const time: SchemaNode[] =
    opts.timestamp !== undefined
      ? [{ type: 'we-timestamp', props: { value: opts.timestamp, relative: true, color: 'text-muted' } }]
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
            props: { ay: 'center', gap: '300' },
            children: [avatar, name, ...time, ...(opts.children ?? [])],
          },
    ],
  };
}
