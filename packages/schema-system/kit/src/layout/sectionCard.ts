import type { SchemaNode } from '@we/schema-shared';

export interface SectionCardOptions {
  title: string;
  /** The line under the title saying what the section is for. */
  description?: string;
  /** Shown at the right of the title row — a spinner, a count, an action. */
  aside?: SchemaNode;
  children: SchemaNode[];
}

/**
 * A titled block of settings or facts, on a card.
 *
 * The unit both the About and Settings routes are built from, six times over between them, with the
 * title/description pair hand-written each time. The `aside` slot exists because one of those six
 * needed a saving spinner beside the title and had to restructure the header to get one.
 */
export function sectionCard(opts: SectionCardOptions): SchemaNode {
  const heading: SchemaNode = {
    type: 'Column',
    props: { gap: '100' },
    children: [
      { type: 'we-text', props: { variant: 'heading-md' }, children: [opts.title] },
      ...(opts.description ? [{ type: 'we-text', children: [opts.description] } as SchemaNode] : []),
    ],
  };

  return {
    type: 'Card',
    props: { bg: 'surface', border: '1px solid border' },
    children: [
      opts.aside ? { type: 'Row', props: { ax: 'between', ay: 'center' }, children: [heading, opts.aside] } : heading,
      ...opts.children,
    ],
  };
}
