import type { SchemaNode, SchemaProp } from '@we/schema-shared';

import type { Content } from '../types.ts';

export interface ComingSoonOptions {
  /**
   * Whether the backend in use can do this yet — an expression over whatever capabilities the
   * caller's backend reports, never a literal. A section reading a capability lights up by itself the
   * day the backend answers yes.
   */
  available: SchemaProp;
  icon: string;
  title: string;
  /** One sentence on what this is for, said either way. */
  description: Content;
  /** What is drawn once it works: the real controls. */
  children?: SchemaNode[];
  /**
   * What is drawn until then: the same controls, or a picture of them, shown but not usable — so a
   * person sees what is coming rather than reading about it. Absent, only the description shows.
   */
  preview?: SchemaNode[];
}

/**
 * A setting the app will have and the backend in use cannot do yet, drawn in full and marked "Coming
 * soon" rather than hidden.
 *
 * Shown rather than left out because the screens are the plan: a person sees what their account will
 * be able to do, and a team sees the whole of it while the backend is built. Driven by a capability
 * rather than a flag in the template, so nothing has to be edited when it starts working, and a
 * backend that never gains it keeps the section greyed out rather than broken.
 *
 * The preview is drawn faded and out of reach of pointer and keyboard both — `inert`, so a control in
 * it cannot be tabbed to and pressed, which a faded control that still worked would invite.
 */
export function comingSoon(opts: ComingSoonOptions): SchemaNode {
  const available = opts.available as SchemaProp;
  return {
    type: 'Card',
    props: { bg: 'surface', gap: '300' },
    children: [
      {
        type: 'Row',
        props: { gap: '300', ay: 'center', ax: 'between', wrap: true },
        children: [
          {
            type: 'Row',
            props: { gap: '300', ay: 'center' },
            children: [
              { type: 'we-icon', props: { name: opts.icon, color: 'text-muted' } },
              { type: 'we-text', props: { fontWeight: 'semibold' }, children: [opts.title] },
            ],
          },
          {
            type: '$if',
            props: {
              condition: notExpr(available),
              then: { type: 'we-tag', props: { variant: 'neutral' }, children: ['Coming soon'] },
            },
          },
        ],
      },
      { type: 'we-text', props: { variant: 'body', color: 'text-muted' }, children: [opts.description] },
      {
        type: '$if',
        props: {
          condition: available,
          then: { type: 'Column', props: { gap: '300' }, children: opts.children ?? [] },
          ...(opts.preview?.length
            ? {
                else: {
                  type: 'div',
                  props: { inert: true, 'aria-hidden': 'true' },
                  styles: { opacity: 0.55 },
                  children: [{ type: 'Column', props: { gap: '300' }, children: opts.preview }],
                },
              }
            : {}),
        },
      },
    ],
  };
}

/** The negation of an expression token, for the badge. */
function notExpr(available: SchemaProp): SchemaProp {
  const source = (available as { $?: unknown } | null)?.$;
  return typeof source === 'string' ? { $: `!(${source})` } : !available;
}
