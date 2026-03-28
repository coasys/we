import type { Placement } from '@we/design-types';

/**
 * Base interface for common menu item properties
 */
interface MenuItemBase {
  id: string;
  label: string;
  disabled?: boolean;
}

/**
 * Regular toggle menu item
 */
export interface PopoverToggleMenuItem extends MenuItemBase {
  type?: 'item';
  icon?: string;
  checked: boolean;
  onToggle?: () => void;
}

/**
 * Group of toggle items with a header
 */
export interface PopoverToggleMenuGroup extends MenuItemBase {
  type: 'group';
  collapsible?: boolean;
  collapsed?: boolean;
  items: PopoverToggleMenuEntry[];
}

/**
 * Union type for all menu entries
 */
export type PopoverToggleMenuEntry = PopoverToggleMenuItem | PopoverToggleMenuGroup;

/**
 * @ai Popover menu with checkbox-style toggle items for multi-select scenarios.
 * Items can be flat or nested in collapsible groups. Each item has a checked state
 * and onToggle callback. Ideal for layer controls, feature toggles, or filter panels.
 */
export interface PopoverToggleMenuProps {
  items: PopoverToggleMenuEntry[];
  placement?: Placement;
  triggerLabel?: string;
  triggerIcon?: string;
  class?: string;
  styles?: Record<string, string | number>;
}
