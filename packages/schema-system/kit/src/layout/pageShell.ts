import type { SchemaNode } from '@we/schema-shared';

export interface PageShellOptions {
  children: SchemaNode[];
  /** Space between the page's sections. */
  gap?: string;
  /** Horizontal padding inside the measure. */
  px?: string;
  /** Vertical padding inside the measure. */
  py?: string;
  /** The measure itself. Defaults to the `lg` layout token, which is what every route uses. */
  maxWidth?: string;
  /** Keep a short page at least a screen tall — the cards route uses this to hold its grid open. */
  minHeight?: string;
}

/**
 * A route's outer box: full width, contents centred, held to a readable measure.
 *
 * Every route in the default template opens with the same two nested Columns — one to centre, one
 * to constrain — and they had drifted into four different paddings for no reason anyone chose.
 *
 * Two Columns rather than one, because centring and constraining are different jobs: the outer one
 * spans the viewport so a route's background reaches the edges, and the inner one holds the measure.
 * A single node cannot do both.
 *
 * ## Padding is the narrow value, and grows
 *
 * The defaults are what a *phone* wants; `mdUpProps` restores what a desktop route has always had.
 * That way round on purpose — base is the unqualified value, so writing the roomy figures there and
 * shrinking them at a breakpoint would need a `smDownProps` that does not exist, and every tier is
 * min-width for a reason: it is the direction that degrades safely when nothing matches.
 *
 * Nothing changes on a desktop, where the surface clears `md` and the tier applies. On a 400px
 * surface a route stops spending a tenth of its width on side padding.
 *
 * An explicit `px`/`py`/`gap` wins outright at every width — a caller who named a number meant it,
 * and quietly overriding it at some widths and not others would be the worst of both.
 */
export function pageShell(opts: PageShellOptions): SchemaNode {
  return {
    type: 'Column',
    props: { width: '100%', ax: 'center' },
    children: [
      {
        type: 'Column',
        props: {
          width: '100%',
          maxWidth: opts.maxWidth ?? 'var(--we-layout-lg)',
          gap: opts.gap ?? '400',
          px: opts.px ?? '300',
          py: opts.py ?? '400',
          mdUpProps: {
            ...(opts.gap === undefined && { gap: '500' }),
            ...(opts.px === undefined && { px: '400' }),
            ...(opts.py === undefined && { py: '500' }),
          },
          ...(opts.minHeight !== undefined && { minHeight: opts.minHeight }),
        },
        children: opts.children,
      },
    ],
  };
}
