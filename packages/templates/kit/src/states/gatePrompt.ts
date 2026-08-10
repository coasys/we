import type { LocalStateField, SchemaNode, SchemaProp } from '@we/schema-shared';

import type { Content } from '../types.ts';

export interface GatePromptOptions {
  icon: string;
  /**
   * The icon's treatment, and the prompt's whole tone in one prop.
   *
   * A gradient reads as an invitation — join this, explore that. A flat neutral or warning colour
   * reads as a dead end: nothing you do here will change it. Pick by whether the prompt has an
   * action under it, and the two will stay legible apart at a glance.
   */
  iconGradient?: string;
  iconColor?: string;
  title: string;
  /** The paragraph under the title. Omit for a prompt whose title says everything. */
  body?: Content;
  /** How wide that paragraph may get before wrapping. */
  bodyWidth?: string;
  /** Anything below the text: a button, a status line, a whole form. */
  children?: SchemaNode[];
  /**
   * Fill the height available and centre inside it — right for a gate standing in for a page,
   * wrong for one inside a panel that has its own flow.
   */
  fill?: boolean;
  /** Let a tall prompt scroll rather than clip. Set it when `children` is a form. */
  scroll?: boolean;
  gap?: string;
  /** State the prompt's own controls need — a `joining` flag, a form's fields. */
  localState?: Record<string, LocalStateField>;
}

/**
 * The page that stands in for a page: an icon, a line saying where you are, a sentence saying why
 * there is nothing here, and — when there is something to do about it — the thing to do.
 *
 * There were eight of these across the two template packages, and two of them (`notConfigured` in
 * `SpaceGate` and in `MarketplaceGate`) were byte-identical in different packages. That is the
 * signature of a shape being copied rather than chosen, and it is the whole argument for this kit:
 * nobody decided the marketplace's "coming soon" should have a different gap and a different title
 * size from every other prompt, it just drifted.
 *
 * Everything it renders stays plain nodes, so a template that wants this shape with a smaller icon
 * or the button above the text edits the expansion. Nothing here is behaviour, so nothing here
 * needs to be code.
 */
export function gatePrompt(opts: GatePromptOptions): SchemaNode {
  const iconProps: Record<string, SchemaProp> = { name: opts.icon, size: 'xl' };
  if (opts.iconGradient) iconProps.gradient = opts.iconGradient;
  if (opts.iconColor) iconProps.color = opts.iconColor;

  const node: SchemaNode = {
    type: 'Column',
    props: {
      flex: '1',
      ...(opts.fill !== false && { height: '100%' }),
      ax: 'center',
      ay: 'center',
      gap: opts.gap ?? '400',
      p: '600',
      ...(opts.scroll && { overflow: 'auto' }),
    },
    children: [
      { type: 'we-icon', props: iconProps },
      { type: 'we-text', props: { variant: 'heading-md', textAlign: 'center' }, children: [opts.title] },
      ...(opts.body !== undefined
        ? [
            {
              type: 'we-text',
              props: {
                variant: 'body',
                textAlign: 'center',
                maxWidth: opts.bodyWidth ?? 'var(--we-layout-xs)',
              },
              children: [opts.body],
            } as SchemaNode,
          ]
        : []),
      ...(opts.children ?? []),
    ],
  };

  return opts.localState ? { ...node, $localState: opts.localState } : node;
}
