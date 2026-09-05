import type { Placement } from '@we/design-types';

/**
 * Base properties shared by actionable menu items.
 */
interface MenuItemBase {
  id: string;
  label: string;
  icon?: string;
  disabled?: boolean;
  /**
   * Leave the entry out while true — the way a schema makes an item conditional.
   *
   * A schema cannot wrap an entry in a conditional: an entry carries a handler, and a value
   * expression cannot hold one. So the condition travels *on* the entry — `hidden: { $:
   * '!modules.call.focusedId' }` — and the menu keeps the entry's place in the list so its
   * neighbours are not rebuilt when it comes and goes.
   */
  hidden?: boolean;
}

/**
 * Action item — click fires a callback and closes the menu.
 */
export interface DropdownMenuAction extends MenuItemBase {
  type?: 'action';
  variant?: 'default' | 'danger';
  /** Optional when the menu has `onSelect`, which is how a schema handles rows that came from data. */
  onAction?: () => void;
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
  /**
   * Fired with the action item that was chosen, after its own `onAction` if it has one.
   *
   * What lets a schema build a menu out of data: `items` can be a comprehension over rows —
   * `local.columns.map(c, { id: c.id, label: c.title })` — which cannot attach a handler per row,
   * so the menu reports the row and one handler on the menu reads it as `arg`.
   */
  onSelect?: (item: DropdownMenuAction) => void;
  placement?: Placement;
  triggerLabel?: string;
  triggerIcon?: string;
  /**
   * How the trigger is drawn, from `we-button`'s own variants. Defaults to `secondary` — a filled
   * neutral chip, which is what a menu standing on its own should look like.
   *
   * `ghost` is the one that matters, and the reason this exists: a menu that belongs to a *row* of
   * controls has to look like one of them rather than like the row's only filled thing. Without it
   * the call bar could not use this component at all — it hand-rolled a `we-popover` around a ghost
   * square instead — and the shell's panel titlebar put a filled pill among four ghost squares.
   */
  triggerVariant?: 'primary' | 'secondary' | 'ghost' | 'danger' | 'outline' | 'bare';
  /**
   * Tooltip on the trigger, and its accessible name.
   *
   * Worth setting on any icon-only trigger, which otherwise says only what its glyph says. A menu's
   * subject is exactly the thing a glyph is worst at carrying — "position", "move to", "more
   * controls" are all `dots-three`-shaped — and the neighbours an icon-only trigger sits among are
   * usually tooltipped already, so leaving it out reads as the one control that will not say what
   * it does.
   */
  triggerTitle?: string;
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
