import type { IconSize } from '@we/primitives/types';

/**
 * Avatar props for user items
 */
export interface AvatarProps {
  src: string;
  name: string;
  status?: 'online' | 'offline' | 'away';
}

/**
 * Base interface for common sidebar item properties
 */
interface SidebarItemBase {
  id: string;
  label: string;
  badge?: string | number;
  disabled?: boolean;
}

/**
 * Regular navigation item
 */
export interface SidebarNavItem extends SidebarItemBase {
  type?: 'item'; // Default type
  icon?: string;
  avatar?: AvatarProps;
  onClick?: () => void;
  active?: boolean;
}

/**
 * Group header with nested items
 */
export interface SidebarGroup extends SidebarItemBase {
  type: 'group';
  collapsible?: boolean;
  collapsed?: boolean;
  items: CollapsibleSidebarItem[];
  /** Enables drag-to-reorder within this group via `we-sortable`. */
  reorderable?: boolean;
  /** Called when the user completes a drag — receives new ordered array of item IDs. */
  onReorder?: (ids: string[]) => void;
  /**
   * An action offered beside the group's label — a `+` that adds to the group, typically.
   *
   * Rendered as a sibling of the header, not inside it: the collapsible header is itself a button,
   * and a button nested in a button is invalid markup that would also toggle the group on the way
   * past. Hidden while the sidebar is collapsed, where there is no label for it to sit beside and
   * it would read as just another item.
   */
  action?: {
    icon: string;
    /** Tooltip and accessible name — the button is icon-only. */
    label: string;
    onClick: () => void;
  };
}

/**
 * Union type for all sidebar items
 */
export type CollapsibleSidebarItem = SidebarNavItem | SidebarGroup;

/**
 * @ai Collapsible sidebar navigation with expand/collapse behavior.
 * Items can be flat nav items (with icon, avatar, badge) or nested groups
 * with collapsible headers. Supports header/footer slots, expand-on-hover,
 * and extensive styling customization for items, badges, and icons.
 */
export interface CollapsibleSidebarProps {
  // Core navigation items (required)
  items: CollapsibleSidebarItem[];

  // Optional footer items (simple icon/label buttons at bottom)
  footerItems?: CollapsibleSidebarItem[];

  // Slots (header, footer) are framework-specific — defined in each impl via extends

  // Positioning
  side?: 'left' | 'right';
  position?: 'static' | 'absolute' | 'fixed'; // Layout positioning
  zIndex?: number; // Z-index for overlay mode

  // Sizing
  collapsedWidth?: string;
  expandedWidth?: string;

  // Behavior
  defaultExpanded?: boolean;
  expandOnHover?: boolean; // vs click to toggle
  transitionDuration?: number; // milliseconds

  // Styling
  bg?: string;
  border?: string;
  padding?: string; // padding for items sections (main and footer)
  gap?: string; // gap between main items and footer items
  centerItems?: boolean; // vertically center main items

  // Item styling
  itemColor?: string;
  itemColorHover?: string;
  itemColorActive?: string;
  itemBg?: string;
  itemBgHover?: string;
  itemBgActive?: string;
  itemPadding?: string; // padding inside each button item
  itemGap?: string; // gap between icon and label inside each item

  // Badge styling (separate since it's visually distinct)
  badgeBg?: string;
  badgeColor?: string;

  // Icon sizing
  iconSize?: IconSize;

  // Callbacks
  onItemClick?: (item: CollapsibleSidebarItem) => void;
  onExpandedChange?: (expanded: boolean) => void;
}
