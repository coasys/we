import type { Placement } from '@we/design-system-types';
import { Accessor, createMemo, createSignal, Index, JSX, Show } from 'solid-js';

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
  type?: 'item'; // Default type
  icon?: string;
  checked: Accessor<boolean> | boolean;
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

export interface PopoverToggleMenuProps {
  items: PopoverToggleMenuEntry[];
  placement?: Placement;
  triggerLabel?: string;
  triggerIcon?: string;
  class?: string;
  styles?: JSX.CSSProperties;
}

/**
 * PopoverToggleMenu
 *
 * A menu with checkbox-style items for toggling multiple options.
 * Supports grouping items with collapsible headers.
 * Perfect for layer controls, feature toggles, or any multi-select scenario.
 *
 * @example
 * ```tsx
 * <PopoverToggleMenu
 *   triggerLabel="Layers"
 *   triggerIcon="layers"
 *   items={[
 *     { id: '1', label: 'Country Outlines', checked: showCountries, onToggle: toggleCountries },
 *     { id: '2', label: 'H3 Grid', checked: showH3, onToggle: toggleH3 },
 *     {
 *       type: 'group',
 *       id: 'data',
 *       label: 'Data Layers',
 *       collapsible: true,
 *       items: [
 *         { id: '3', label: 'Population', checked: showPop, onToggle: togglePop },
 *       ]
 *     }
 *   ]}
 * />
 * ```
 */
export function PopoverToggleMenu(props: PopoverToggleMenuProps) {
  let popoverRef: HTMLElement | undefined;

  // Track group collapse states
  const [groupStates, setGroupStates] = createSignal<Record<string, boolean>>({});

  const handleToggle = (item: PopoverToggleMenuItem) => {
    if (item.disabled) return;
    item.onToggle?.();
  };

  const isChecked = (item: PopoverToggleMenuItem): boolean => {
    return typeof item.checked === 'function' ? item.checked() : item.checked;
  };

  const toggleGroup = (groupId: string) => {
    setGroupStates((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const isGroupCollapsed = (group: PopoverToggleMenuGroup): boolean => {
    const internalState = groupStates()[group.id];
    return internalState !== undefined ? internalState : (group.collapsed ?? false);
  };

  const renderItem = (getItem: () => PopoverToggleMenuItem) => {
    const item = getItem();
    const checked = createMemo(() => isChecked(getItem()));

    return (
      <we-menu-item
        onClick={() => handleToggle(item)}
        selected={checked()}
        opacity={item.disabled ? 0.5 : 1}
        cursor={item.disabled ? 'not-allowed' : 'pointer'}
      >
        <Show when={item.icon}>
          <we-icon name={item.icon!} />
        </Show>
        <we-text>{item.label}</we-text>
        <Show when={checked()}>
          <we-icon name="check" size="xs" weight="bold" color="primary-500" />
        </Show>
      </we-menu-item>
    );
  };

  const renderGroup = (getGroup: () => PopoverToggleMenuGroup) => {
    const group = getGroup();
    const collapsed = createMemo(() => isGroupCollapsed(getGroup()));
    const groupItems = createMemo(() => getGroup().items);

    return (
      <>
        {/* Group header */}
        <Show when={group.collapsible !== false}>
          <we-menu-item
            onClick={() => !group.disabled && toggleGroup(group.id)}
            opacity={group.disabled ? 0.5 : 1}
            cursor={group.disabled ? 'not-allowed' : 'pointer'}
            color="ui-400"
            prop:hoverProps={{ color: 'ui-500' }}
          >
            <we-icon name={collapsed() ? 'caret-right' : 'caret-down'} size="xs" />
            <we-text>{group.label}</we-text>
          </we-menu-item>
        </Show>

        {/* Non-collapsible header */}
        <Show when={group.collapsible === false}>
          <we-menu-item color="ui-500" cursor="default" pointerEvents="none">
            <we-text>{group.label}</we-text>
          </we-menu-item>
        </Show>

        {/* Group items */}
        <Show when={!collapsed()}>
          <Index each={groupItems()}>{(getEntry) => renderEntry(getEntry)}</Index>
        </Show>
      </>
    );
  };

  const renderEntry = (getEntry: () => PopoverToggleMenuEntry) => {
    const entry = getEntry();

    if (entry.type === 'group') {
      return renderGroup(getEntry as () => PopoverToggleMenuGroup);
    }

    return renderItem(getEntry as () => PopoverToggleMenuItem);
  };

  return (
    <we-popover
      ref={popoverRef}
      class={`we-popover-toggle-menu ${props.class || ''}`}
      styles={props.styles}
      placement={props.placement || 'bottom'}
      data-we-menu
    >
      <we-button slot="trigger" bg="ui-200" color="ui-800">
        <Show when={props.triggerIcon}>
          <we-icon name={props.triggerIcon!} />
        </Show>
        {props.triggerLabel || 'Options'}
      </we-button>

      <we-menu slot="content">
        <Index each={props.items}>{(getEntry) => renderEntry(getEntry)}</Index>
      </we-menu>
    </we-popover>
  );
}
