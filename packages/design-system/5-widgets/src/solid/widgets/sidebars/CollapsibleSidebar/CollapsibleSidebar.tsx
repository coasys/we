import { iconSizeToVar, parseBorder, tokenVar } from '@we/design-utils';
import { IconSize } from 'packages/design-system/3-primitives/dist/types';
import { createContext, createEffect, createMemo, createSignal, Index, type JSX, Show } from 'solid-js';
import { Dynamic } from 'solid-js/web';

/**
 * Context provided by CollapsibleSidebar to its children
 * Allows header/footer content to react to expansion state
 */
export const CollapsibleSidebarContext = createContext<{
  isExpanded: () => boolean;
}>();

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
}

/**
 * Union type for all sidebar items
 */
export type CollapsibleSidebarItem = SidebarNavItem | SidebarGroup;

export interface CollapsibleSidebarProps {
  // Core navigation items (required)
  items: CollapsibleSidebarItem[];

  // Optional footer items (simple icon/label buttons at bottom)
  footerItems?: CollapsibleSidebarItem[];

  // Slots for flexible content (use SchemaNode children via slots)
  header?: JSX.Element; // Custom header (logo, brand)
  footer?: JSX.Element; // Custom footer (overrides footerItems)

  // Positioning
  side?: 'left' | 'right';
  position?: 'static' | 'absolute' | 'fixed'; // Layout positioning
  zIndex?: string | number; // Z-index for overlay mode

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

export function CollapsibleSidebar(props: CollapsibleSidebarProps) {
  // Merge with defaults
  const side = () => props.side ?? 'left';
  const position = () => props.position ?? 'static';
  const transitionDuration = () => props.transitionDuration ?? 300;
  const expandOnHover = () => props.expandOnHover ?? true;
  const iconSize = () => props.iconSize ?? '';
  const badgeBg = () => props.badgeBg ?? 'primary-500';
  const badgeColor = () => props.badgeColor ?? 'ui-0';
  const padding = () => tokenVar('space', props.padding ?? '300');
  const itemPadding = () => tokenVar('space', props.itemPadding ?? '300');
  const itemGap = () => tokenVar('space', props.itemGap ?? '300');
  const gap = () => tokenVar('space', props.gap ?? '200');
  const centerItems = () => props.centerItems ?? false;

  // Calculate collapsed width based on icon size, item padding, and sidebar padding
  const collapsedWidth = () =>
    props.collapsedWidth ??
    `calc(${iconSizeToVar(props.iconSize ?? '')} + 2 * var(--sidebar-item-padding) + 2 * var(--sidebar-padding))`;
  const expandedWidth = () => props.expandedWidth ?? '240px';

  // Make items reactive
  const items = () => props.items;
  const footerItems = () => props.footerItems;

  // Convert tokens to CSS variables (only for sidebar container, not button)
  const bg = () => tokenVar('color', props.bg ?? 'ui-0');
  const border = () => parseBorder(props.border, '1px solid ui-200');

  // State
  const [isExpanded, setIsExpanded] = createSignal(props.defaultExpanded ?? false);
  const [groupStates, setGroupStates] = createSignal<Record<string, boolean>>({});

  // Notify parent of expansion changes
  createEffect(() => {
    props.onExpandedChange?.(isExpanded());
  });

  // Event handlers
  const handleMouseEnter = () => {
    if (expandOnHover()) setIsExpanded(true);
  };

  const handleMouseLeave = () => {
    if (expandOnHover()) setIsExpanded(false);
  };

  const handleItemClick = (item: SidebarNavItem) => {
    if (item.disabled) return;
    item.onClick?.();
    props.onItemClick?.(item);
  };

  const toggleGroup = (groupId: string) => {
    setGroupStates((prev) => ({
      ...prev,
      [groupId]: !prev[groupId],
    }));
  };

  const isGroupCollapsed = (group: SidebarGroup): boolean => {
    // Check internal state first, fall back to prop
    const internalState = groupStates()[group.id];
    return internalState !== undefined ? internalState : (group.collapsed ?? false);
  };

  // CSS variables for dynamic styles (sidebar container only)
  const cssVars = (): JSX.CSSProperties => ({
    '--sidebar-collapsed-width': collapsedWidth(),
    '--sidebar-expanded-width': expandedWidth(),
    '--sidebar-bg': bg(),
    '--sidebar-border': border(),
    '--sidebar-position': position(),
    '--sidebar-z-index': props.zIndex,
    '--sidebar-transition-duration': `${transitionDuration()}ms`,
    '--sidebar-padding': padding(),
    '--sidebar-item-padding': itemPadding(),
    '--sidebar-item-gap': itemGap(),
    '--sidebar-gap': gap(),
  });

  // Class names
  const classes = () => {
    const classList = ['we-collapsible-sidebar'];
    if (side()) classList.push(side());
    if (position()) classList.push(position());
    if (isExpanded()) classList.push('we-collapsible-sidebar--expanded');
    if (centerItems()) classList.push('we-collapsible-sidebar--center-items');
    return classList.join(' ');
  };

  const renderItem = (getItem: () => SidebarNavItem) => {
    // Access the item once for stable properties (id, icon, label, etc.)
    const item = getItem();

    // Create a reactive memo for the active state by accessing getItem() inside
    const isActive = createMemo(() => getItem().active || false);

    // // Map icon size to avatar size token
    // const avatarSize = () => {
    //   const size = iconSize();
    //   if (size === 'xs') return 'xs';
    //   if (size === 'sm') return 'sm';
    //   if (size === 'md') return 'md';
    //   if (size === 'lg') return 'lg';
    //   if (size === 'xl') return 'xl';
    //   return 'md'; // default
    // };

    return (
      <we-button
        class="we-collapsible-sidebar__item"
        onClick={() => handleItemClick(item)}
        disabled={item.disabled}
        height="auto"
        p={props.itemPadding ?? '300'}
        ax="start"
        direction={side() === 'left' ? 'row' : 'row-reverse'}
        gap="0" // Gap handled in CSS to avoid shifting on collapse
        bg={isActive() ? (props.itemBgActive ?? 'ui-100') : (props.itemBg ?? '')}
        color={isActive() ? (props.itemColorActive ?? 'primary-600') : (props.itemColor ?? 'ui-700')}
        prop:hoverProps={{
          bg: isActive() ? (props.itemBgActive ?? 'ui-100') : (props.itemBgHover ?? 'ui-50'),
          color: isActive()
            ? (props.itemColorActive ?? 'primary-600')
            : (props.itemColorHover ?? props.itemColor ?? 'ui-900'),
          opacity: isActive() ? 0.9 : undefined,
        }}
      >
        {/* Avatar or Icon */}
        <Show
          when={item.avatar}
          fallback={<we-icon class="we-collapsible-sidebar__item-icon" name={item.icon ?? ''} size={iconSize()} />}
        >
          <we-avatar
            class="we-collapsible-sidebar__item-avatar"
            image={item.avatar!.src}
            initials={item.avatar!.name?.slice(0, 2)}
            size="26px"
            // status={item.avatar!.status}
          />
        </Show>

        <div class="we-collapsible-sidebar__item-content">
          <we-text class="we-collapsible-sidebar__item-label">{item.label}</we-text>
          <Show when={item.badge}>
            <we-badge
              class="we-collapsible-sidebar__item-badge"
              size="sm"
              weight="600"
              bg={badgeBg()}
              color={badgeColor()}
            >
              {item.badge}
            </we-badge>
          </Show>
        </div>
      </we-button>
    );
  };

  const renderGroup = (getGroup: () => SidebarGroup) => {
    const group = getGroup();
    const collapsed = createMemo(() => isGroupCollapsed(getGroup()));

    // Access items reactively to preserve reactivity for nested items
    const groupItems = createMemo(() => getGroup().items);

    return (
      <div class="we-collapsible-sidebar__group">
        {/* Group header */}
        <Dynamic
          component={group.collapsible !== false ? 'button' : 'div'}
          class={`we-collapsible-sidebar__group-header${group.collapsible === false ? ' we-collapsible-sidebar__group-header--static' : ''}`}
          onClick={group.collapsible !== false ? () => toggleGroup(group.id) : undefined}
          disabled={group.collapsible !== false ? group.disabled : undefined}
          style={{ opacity: isExpanded() ? 1 : 0, transition: `opacity ${transitionDuration()}ms ease-in-out` }}
        >
          <we-text
            class="we-collapsible-sidebar__group-label"
            size="300"
            weight="600"
            color={group.collapsible !== false ? 'ui-400' : 'ui-500'}
          >
            {group.label}
          </we-text>
          <Show when={group.badge}>
            <we-badge class="we-collapsible-sidebar__group-badge" size="sm" bg="ui-200" color="ui-600">
              {group.badge}
            </we-badge>
          </Show>
          <Show when={group.collapsible !== false}>
            <we-icon
              class="we-collapsible-sidebar__group-icon"
              name={collapsed() ? 'caret-right' : 'caret-down'}
              size="xs"
              color="ui-400"
            />
          </Show>
        </Dynamic>

        {/* Group items */}
        <div
          class="we-collapsible-sidebar__group-items"
          style={{
            display: 'grid',
            'grid-template-rows': collapsed() ? '0fr' : '1fr',
            opacity: collapsed() ? 0 : 1,
            transition: `grid-template-rows ${transitionDuration()}ms ease-in-out, opacity ${transitionDuration() * 0.6}ms ease-in-out`,
          }}
        >
          <div style={{ overflow: 'hidden' }}>
            <Index each={groupItems()}>{(getItem) => renderEntry(getItem)}</Index>
          </div>
        </div>
      </div>
    );
  };

  const renderEntry = (getEntry: () => CollapsibleSidebarItem) => {
    // Snapshot the entry once for type checking and stable properties
    const entry = getEntry();

    // Type guard
    if (entry.type === 'group') {
      // For groups, pass a stable getter that accesses the same index
      return renderGroup(getEntry as () => SidebarGroup);
    }

    // For items, pass the getter to preserve reactivity for active state
    return renderItem(getEntry as () => SidebarNavItem);
  };

  const contextValue = {
    isExpanded,
  };

  return (
    <CollapsibleSidebarContext.Provider value={contextValue}>
      <div class={classes()} style={cssVars()} onMouseEnter={handleMouseEnter} onMouseLeave={handleMouseLeave}>
        {/* Header slot */}
        <Show when={props.header}>{props.header}</Show>

        {/* Main items */}
        <div class="we-collapsible-sidebar__items">
          <Index each={items()}>{(getItem) => renderEntry(getItem)}</Index>
        </div>

        {/* Footer items or custom footer slot */}
        <Show when={props.footer || footerItems()}>
          <div class="we-collapsible-sidebar__footer">
            <Show
              when={props.footer}
              fallback={<Index each={footerItems()}>{(getItem) => renderEntry(getItem)}</Index>}
            >
              {props.footer}
            </Show>
          </div>
        </Show>
      </div>
    </CollapsibleSidebarContext.Provider>
  );
}
