import type { JSX } from 'solid-js';

export interface CollapsedContentProps {
  /** Whether the content is currently in collapsed (height-constrained) state. Drive from $localState. */
  collapsed: boolean;
  /** Called when the expand/collapse toggle button is clicked. Wire to $toggleLocal or $setLocal for modal. */
  onExpandClick?: () => void;
  /** Show the expand/collapse toggle button. Default true. Pass false in 'expanded' display mode. */
  showToggle?: boolean;
  /** Icon name for the toggle button. Defaults to caret-down/caret-up. Pass 'arrows-out' for grid/modal mode. */
  icon?: string;
  /** Max height when collapsed. Default '280px'. */
  maxHeight?: string;
  /** CSS colour for the bottom fade gradient. Should match the card background. Default: neutral-100 token. */
  fadeColor?: string;
  children?: JSX.Element;
  class?: string;
  styles?: Record<string, string | number>;
}
