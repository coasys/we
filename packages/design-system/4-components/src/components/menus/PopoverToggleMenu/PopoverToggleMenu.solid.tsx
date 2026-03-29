import { Accessor, createMemo, createSignal, Index, Show } from 'solid-js';

export type * from './PopoverToggleMenu.types';
import type { PopoverToggleMenuGroup, PopoverToggleMenuItem, PopoverToggleMenuProps } from './PopoverToggleMenu.types';

// Solid-specific: items within arrays can pass reactive accessors for checked state
type SolidToggleMenuItem = Omit<PopoverToggleMenuItem, 'checked'> & {
  checked: Accessor<boolean> | boolean;
};
type SolidToggleMenuEntry =
  | SolidToggleMenuItem
  | (Omit<PopoverToggleMenuGroup, 'items'> & { items: SolidToggleMenuEntry[] });
type SolidToggleMenuProps = Omit<PopoverToggleMenuProps, 'items'> & {
  items: SolidToggleMenuEntry[];
};

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
export function PopoverToggleMenu(props: SolidToggleMenuProps) {
  let popoverRef: HTMLElement | undefined;

  // Track group collapse states
  const [groupStates, setGroupStates] = createSignal<Record<string, boolean>>({});

  const handleToggle = (item: SolidToggleMenuItem) => {
    if (item.disabled) return;
    item.onToggle?.();
  };

  const isChecked = (item: SolidToggleMenuItem): boolean => {
    return typeof item.checked === 'function' ? item.checked() : item.checked;
  };

  const toggleGroup = (groupId: string) => {
    setGroupStates((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const isGroupCollapsed = (group: SolidToggleMenuEntry & { type: 'group' }): boolean => {
    const internalState = groupStates()[group.id];
    return internalState !== undefined ? internalState : (group.collapsed ?? false);
  };

  const renderItem = (getItem: () => SolidToggleMenuItem) => {
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

  const renderGroup = (getGroup: () => SolidToggleMenuEntry & { type: 'group' }) => {
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
            color="neutral-400"
            prop:hoverProps={{ color: 'neutral-500' }}
          >
            <we-icon name={collapsed() ? 'caret-right' : 'caret-down'} size="xs" />
            <we-text>{group.label}</we-text>
          </we-menu-item>
        </Show>

        {/* Non-collapsible header */}
        <Show when={group.collapsible === false}>
          <we-menu-item color="neutral-500" cursor="default" pointerEvents="none">
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

  const renderEntry = (getEntry: () => SolidToggleMenuEntry) => {
    const entry = getEntry();

    if (entry.type === 'group') {
      return renderGroup(getEntry as () => SolidToggleMenuEntry & { type: 'group' });
    }

    return renderItem(getEntry as () => SolidToggleMenuItem);
  };

  return (
    <we-popover
      ref={popoverRef}
      class={`we-popover-toggle-menu ${props.class || ''}`}
      styles={props.styles}
      placement={props.placement || 'bottom'}
      data-we-menu
    >
      <we-button slot="trigger" bg="neutral-200" color="neutral-800">
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
