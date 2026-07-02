import type { SchemaNode } from '@we/schema-shared';

export interface CardShellOptions {
  /** Nodes always visible regardless of display mode (compact header row) */
  header: SchemaNode[];
  /** Nodes shown in expanded/grid modes, wrapped in CollapsedContent */
  body: SchemaNode[];
  /** Override for modal content in grid mode; defaults to body */
  modalContent?: SchemaNode[];
  /**
   * maxHeight for CollapsedContent. Accepts a px string or a schema expression.
   * Defaults to grid→200px / other→100px.
   */
  maxHeight?: string | Record<string, unknown>;
}

const defaultMaxHeight = {
  $if: {
    condition: { $eq: [{ $local: 'displayMode' }, 'grid'] },
    then: '250px',
    else: '100px',
  },
};

/**
 * Generates a card node with per-item expand/modal state for use inside $each.
 *
 * - compact: header only
 * - expanded: header + CollapsedContent that expands inline
 * - grid: header + CollapsedContent where expand opens a modal
 *
 * $local reads inside body/modal resolve up the ancestor tree, so route-level
 * $localState (displayMode, sortDirection, etc.) remains accessible.
 */
export function cardShell(opts: CardShellOptions): SchemaNode {
  const { header, body, modalContent } = opts;
  const maxHeight = opts.maxHeight ?? defaultMaxHeight;

  return {
    $localState: {
      expanded: { type: 'boolean', initial: false },
      modalOpen: { type: 'boolean', initial: false },
    },
    type: 'Card',
    props: {
      bg: 'neutral-100',
      border: '1px solid neutral-200',
      width: '100%',
    },
    children: [
      // Always-visible compact header
      ...header,

      // Body: expanded = full content; compact/grid = height-constrained with fade
      {
        type: '$if',
        props: {
          condition: { $eq: [{ $local: 'displayMode' }, 'expanded'] },
          then: {
            type: 'Column',
            props: { gap: '300' },
            children: body,
          },
          else: {
            type: 'CollapsedContent',
            props: {
              maxHeight,
              collapsed: { $not: { $local: 'expanded' } },
              icon: {
                $if: {
                  condition: { $eq: [{ $local: 'displayMode' }, 'grid'] },
                  then: 'arrows-out',
                  else: null,
                },
              },
              onExpandClick: {
                $if: {
                  condition: { $eq: [{ $local: 'displayMode' }, 'grid'] },
                  then: { $setLocal: 'modalOpen', value: true },
                  else: { $toggleLocal: 'expanded' },
                },
              },
            },
            children: body,
          },
        },
      },

      // Grid-expand modal
      {
        type: '$if',
        props: {
          condition: { $local: 'modalOpen' },
          then: {
            type: 'we-modal',
            props: { close: { $setLocal: 'modalOpen', value: false } },
            children: [
              {
                type: 'Column',
                props: { gap: '400', p: '400' },
                children: modalContent ?? body,
              },
            ],
          },
        },
      },
    ],
  };
}

/** Grid wrapper that switches between 1-column and 3-column based on displayMode */
export const gridWrapper = (children: SchemaNode[]): SchemaNode => ({
  type: 'Grid',
  props: {
    gap: '400',
    width: '100%',
    columns: {
      $if: {
        condition: { $eq: [{ $local: 'displayMode' }, 'grid'] },
        then: 3,
        else: 1,
      },
    },
  },
  children,
});
