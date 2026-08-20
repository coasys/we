import type { Placement } from '@we/design-types';

/**
 * Base properties shared by actionable menu items.
 */
interface MenuItemBase {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
}

/**
 * Action item — click fires a callback and closes the menu.
 */
export interface DropdownMenuAction extends MenuItemBase {
  type?: 'action';
  variant?: 'default' | 'danger';
  onAction: () => void;
}

/**
 * Toggle item — click toggles checked state, menu stays open.
 */
export interface DropdownMenuToggle extends MenuItemBase {
  type: 'toggle';
  checked: boolean;
  onToggle: () => void;
}

/**
 * Group of items with an optional collapsible header.
 */
export interface DropdownMenuGroup {
  type: 'group';
  id: string;
  label: string;
  disabled?: boolean;
  collapsible?: boolean;
  collapsed?: boolean;
  items: DropdownMenuEntry[];
}

/**
 * Visual divider between sections.
 */
export interface DropdownMenuDivider {
  type: 'divider';
}

/**
 * Union of all entry types.
 */
export type DropdownMenuEntry = DropdownMenuAction | DropdownMenuToggle | DropdownMenuGroup | DropdownMenuDivider;

/**
 * @ai Flexible dropdown menu for actions, toggles, and grouped items.
 * Use for context menus, settings panels, layer controls, and command palettes.
 * Items can be actions (click to execute, menu closes), toggles (click to check/uncheck, menu stays open),
 * collapsible groups, or dividers. Supports icons, disabled state, and danger variant.
 */
export interface DropdownMenuProps {
  items: DropdownMenuEntry[];
  placement?: Placement;
  triggerLabel?: string;
  triggerIcon?: string;
  /**
   * Trigger size, matching `we-button`'s scale.
   *
   * Defaults to `md`, which is `we-button`'s own default and is the wrong one in any bar of `sm`
   * controls — the trigger simply stood taller than everything beside it, with no way to say
   * otherwise.
   */
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  /**
   * Size of the items in the list. Defaults to `size`.
   *
   * Separate because the two are separate: the trigger has to fit whatever chrome it sits in, and the
   * list has to be readable — and those pull apart at the small end. The shell's panel titlebar wants
   * a 24px trigger and would be unreadable with 12px items.
   *
   * `size` used to reach the trigger alone, so a menu asking to be small got a small button and a
   * full-size list, which is how the panel menu ended up with items visibly larger than the panel's
   * own controls.
   */
  itemSize?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  class?: string;
  styles?: Record<string, string | number>;
}
