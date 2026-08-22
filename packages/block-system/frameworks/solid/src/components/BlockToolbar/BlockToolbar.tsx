import { Row } from '@we/components/solid';
import type { JSX } from 'solid-js';

export type BlockToolbarPlacement = 'inside' | 'above';

interface BlockToolbarProps {
  /** Where to position the toolbar relative to the parent block.
   *  - `'inside'` (default): inset top-right corner (top: 5px, right: 5px).
   *    Suitable for media blocks where the content area has visual chrome.
   *  - `'above'`: floats above the block (bottom: 100%, right: 0).
   *    Use when the block content fills the full width, e.g. collection blocks,
   *    so the toolbar never obscures editable content.
   */
  placement?: BlockToolbarPlacement;
  children: JSX.Element;
  /** Prevent clicks/mousedowns from propagating into the editor below. */
  stopPropagation?: boolean;
}

function stop(e: MouseEvent) {
  e.stopPropagation();
}

/**
 * Shared selection toolbar shell used by all block input components.
 *
 * Renders an absolutely-positioned Row with the standard visual language
 * (background, border, radius, gap). Wrap your toolbar buttons in this
 * instead of hand-rolling `<Row position="absolute" ...>` in each block.
 *
 * The parent block wrapper must have `position: relative` (or `Column position="relative"`).
 *
 * @example
 * <Show when={props.isSelected()}>
 *   <BlockToolbar>
 *     <we-button square variant="ghost" onClick={handleDelete}>
 *       <we-icon name="x" size="xs" />
 *     </we-button>
 *   </BlockToolbar>
 * </Show>
 */
export function BlockToolbar(props: BlockToolbarProps) {
  const placement = props.placement ?? 'inside';

  const positionProps =
    placement === 'above'
      ? ({ bottom: '100%', right: '0', mb: '100' } as const)
      : ({ top: '5px', right: '5px' } as const);

  return (
    <Row
      position="absolute"
      {...positionProps}
      p="200"
      r="200"
      gap="200"
      border="1px solid var(--we-role-border)"
      bg="surface"
      onMouseDown={props.stopPropagation !== false ? stop : undefined}
      onClick={props.stopPropagation !== false ? stop : undefined}
    >
      {props.children}
    </Row>
  );
}
