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
          gap: opts.gap ?? '500',
          px: opts.px ?? '400',
          py: opts.py ?? '500',
          ...(opts.minHeight !== undefined && { minHeight: opts.minHeight }),
        },
        children: opts.children,
      },
    ],
  };
}
