import { Accessor, createMemo, createSignal, Index, Show } from 'solid-js';

export type * from './DropdownMenu.types';
import type {
  DropdownMenuAction,
  DropdownMenuGroup,
  DropdownMenuProps,
  DropdownMenuToggle,
} from './DropdownMenu.types';

// Solid-specific: toggle items can pass reactive accessors for checked state
type SolidDropdownMenuToggle = Omit<DropdownMenuToggle, 'checked'> & {
  checked: Accessor<boolean> | boolean;
};
type SolidDropdownMenuEntry =
  | DropdownMenuAction
  | SolidDropdownMenuToggle
  | (Omit<DropdownMenuGroup, 'items'> & { items: SolidDropdownMenuEntry[] })
  | { type: 'divider' };
type SolidDropdownMenuProps = Omit<DropdownMenuProps, 'items'> & {
  items: SolidDropdownMenuEntry[];
};

/**
 * DropdownMenu
 *
 * A flexible dropdown menu supporting action items, toggle items,
 * collapsible groups, and dividers.
 *
 * - Action items fire a callback and close the menu.
 * - Toggle items flip a checked state and keep the menu open.
 * - Groups organize items under collapsible headers.
 * - Dividers add visual separation between sections.
 *
 * @ai Flexible dropdown menu for actions, toggles, and grouped items. Use for context menus, settings panels, layer controls, and command palettes.
 *
 * @example
 * ```tsx
 * <DropdownMenu
 *   triggerLabel="Options"
 *   triggerIcon="dots-three"
 *   items={[
 *     { id: 'edit', label: 'Edit', icon: 'pencil', onAction: handleEdit },
 *     { id: 'duplicate', label: 'Duplicate', icon: 'copy', onAction: handleDuplicate },
 *     { type: 'divider' },
 *     { type: 'toggle', id: 'pin', label: 'Pinned', icon: 'push-pin', checked: isPinned, onToggle: togglePin },
 *     { type: 'divider' },
 *     { id: 'delete', label: 'Delete', icon: 'trash', variant: 'danger', onAction: handleDelete },
 *   ]}
 * />
 * ```
 */
export function DropdownMenu(props: SolidDropdownMenuProps) {
  let popoverRef: HTMLElement | undefined;

  // Track group collapse states
  const [groupStates, setGroupStates] = createSignal<Record<string, boolean>>({});

  const closeMenu = () => {
    popoverRef?.removeAttribute('open');
  };

  const handleAction = (item: DropdownMenuAction) => {
    if (item.disabled) return;
    item.onAction();
    closeMenu();
  };

  const handleToggle = (item: SolidDropdownMenuToggle) => {
    if (item.disabled) return;
    item.onToggle();
  };

  const isChecked = (item: SolidDropdownMenuToggle): boolean => {
    return typeof item.checked === 'function' ? item.checked() : item.checked;
  };

  const toggleGroup = (groupId: string) => {
    setGroupStates((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const isGroupCollapsed = (group: DropdownMenuGroup): boolean => {
    const internalState = groupStates()[group.id];
    return internalState !== undefined ? internalState : (group.collapsed ?? false);
  };

  /**
   * What each size means for an item: the type, the glyph beside it, and the room around both.
   *
   * `md` restates `we-menu-item`'s own defaults rather than leaving them unset, so every size is
   * legible in one place — reading the table is how you tell what "one smaller" actually changes.
   */
  const ITEM_SIZES = {
    xs: { fontSize: '100', icon: 'xs', px: '200', py: '100', gap: '200' },
    sm: { fontSize: '200', icon: 'sm', px: '300', py: '100', gap: '200' },
    md: { fontSize: '300', icon: 'md', px: '300', py: '200', gap: '300' },
    lg: { fontSize: '400', icon: 'md', px: '400', py: '300', gap: '300' },
    xl: { fontSize: '500', icon: 'lg', px: '400', py: '300', gap: '400' },
  } as const;

  const metrics = () => ITEM_SIZES[props.itemSize ?? props.size ?? 'md'];

  const renderActionItem = (getItem: () => DropdownMenuAction) => {
    const item = getItem();
    return (
      <we-menu-item
        on:select={() => handleAction(item)}
        variant={item.variant || 'default'}
        opacity={item.disabled ? 0.5 : 1}
        cursor={item.disabled ? 'not-allowed' : 'pointer'}
        px={metrics().px}
        py={metrics().py}
        gap={metrics().gap}
        fontSize={metrics().fontSize}
      >
        <Show when={item.icon}>
          <we-icon name={item.icon!} size={metrics().icon} />
        </Show>
        <we-text fontSize={metrics().fontSize}>{item.label}</we-text>
      </we-menu-item>
    );
  };

  const renderToggleItem = (getItem: () => SolidDropdownMenuToggle) => {
    const item = getItem();
    const checked = createMemo(() => isChecked(getItem()));

    return (
      <we-menu-item
        on:select={() => handleToggle(item)}
        selected={checked()}
        opacity={item.disabled ? 0.5 : 1}
        cursor={item.disabled ? 'not-allowed' : 'pointer'}
        px={metrics().px}
        py={metrics().py}
        gap={metrics().gap}
        fontSize={metrics().fontSize}
      >
        <Show when={item.icon}>
          <we-icon name={item.icon!} size={metrics().icon} />
        </Show>
        <we-text fontSize={metrics().fontSize}>{item.label}</we-text>
        <Show when={checked()}>
          <we-icon name="check" size="xs" weight="bold" color="accent" />
        </Show>
      </we-menu-item>
    );
  };

  const renderGroup = (getGroup: () => DropdownMenuGroup & { items: SolidDropdownMenuEntry[] }) => {
    const group = getGroup();
    const collapsed = createMemo(() => isGroupCollapsed(getGroup()));
    const groupItems = createMemo(() => getGroup().items);

    return (
      <>
        {/* Collapsible header */}
        <Show when={group.collapsible !== false}>
          <we-menu-item
            on:select={() => !group.disabled && toggleGroup(group.id)}
            opacity={group.disabled ? 0.5 : 1}
            cursor={group.disabled ? 'not-allowed' : 'pointer'}
            color="text-faint"
            prop:hoverProps={{ color: 'neutral-500' }}
          >
            <we-icon name={collapsed() ? 'caret-right' : 'caret-down'} size="xs" />
            <we-text>{group.label}</we-text>
          </we-menu-item>
        </Show>

        {/* Non-collapsible header */}
        <Show when={group.collapsible === false}>
          <we-menu-item color="text-muted" cursor="default" pointerEvents="none">
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

  const renderDivider = () => {
    return <we-divider />;
  };

  const renderEntry = (getEntry: () => SolidDropdownMenuEntry) => {
    const entry = getEntry();

    if (entry.type === 'divider') {
      return renderDivider();
    }

    if (entry.type === 'group') {
      return renderGroup(getEntry as () => DropdownMenuGroup & { items: SolidDropdownMenuEntry[] });
    }

    if (entry.type === 'toggle') {
      return renderToggleItem(getEntry as () => SolidDropdownMenuToggle);
    }

    // Default: action item (type is 'action' or undefined)
    return renderActionItem(getEntry as () => DropdownMenuAction);
  };

  return (
    <we-popover
      ref={popoverRef}
      class={`we-dropdown-menu ${props.class || ''}`}
      styles={props.styles}
      placement={props.placement || 'bottom'}
      data-we-menu
    >
      <we-button slot="trigger" size={props.size} bg="surface-active" color="text">
        <Show when={props.triggerIcon}>
          <we-icon name={props.triggerIcon!} />
        </Show>
        {/*
          `??` rather than `||`, so an explicit empty label means "icon only" instead of falling back
          to the default. It could not be suppressed before: any icon-only trigger silently read
          "Options", which is the least informative word available for a menu that always has a
          subject — and callers had no way to say otherwise.
        */}
        {props.triggerLabel ?? 'Options'}
      </we-button>

      <we-menu slot="content">
        <Index each={props.items}>{(getEntry) => renderEntry(getEntry)}</Index>
      </we-menu>
    </we-popover>
  );
}
