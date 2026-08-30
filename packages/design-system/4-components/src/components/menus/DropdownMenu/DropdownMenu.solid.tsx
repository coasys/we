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
    item.onAction?.();
    props.onSelect?.(item);
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

  /*
    Every binding reads through the accessor, rather than off a snapshot taken once.

    `const item = getItem()` at the top of a render function runs exactly once — at creation, outside
    any reactive scope — so a menu built from data was frozen at whatever the data said the first
    time it was opened. A label bound to a store, an entry that becomes disabled while the menu is
    up, a variant that turns danger: none of them ever changed on screen. `Index` gives a reactive
    accessor *per position* precisely so this can work; the snapshot threw that away.

    The handler still closes over the accessor rather than the value, so a click acts on the entry as
    it is now and not as it was when the menu opened.
  */
  const renderActionItem = (getItem: () => DropdownMenuAction) => {
    return (
      <we-menu-item
        on:select={() => handleAction(getItem())}
        variant={getItem().variant || 'default'}
        opacity={getItem().disabled ? 0.5 : 1}
        cursor={getItem().disabled ? 'not-allowed' : 'pointer'}
        px={metrics().px}
        py={metrics().py}
        gap={metrics().gap}
        fontSize={metrics().fontSize}
      >
        <Show when={getItem().icon}>
          <we-icon name={getItem().icon!} size={metrics().icon} />
        </Show>
        <we-text fontSize={metrics().fontSize}>{getItem().label}</we-text>
      </we-menu-item>
    );
  };

  const renderToggleItem = (getItem: () => SolidDropdownMenuToggle) => {
    const checked = createMemo(() => isChecked(getItem()));

    return (
      <we-menu-item
        on:select={() => handleToggle(getItem())}
        selected={checked()}
        opacity={getItem().disabled ? 0.5 : 1}
        cursor={getItem().disabled ? 'not-allowed' : 'pointer'}
        px={metrics().px}
        py={metrics().py}
        gap={metrics().gap}
        fontSize={metrics().fontSize}
      >
        <Show when={getItem().icon}>
          <we-icon name={getItem().icon!} size={metrics().icon} />
        </Show>
        <we-text fontSize={metrics().fontSize}>{getItem().label}</we-text>
        <Show when={checked()}>
          <we-icon name="check" size="xs" weight="bold" color="accent" />
        </Show>
      </we-menu-item>
    );
  };

  const renderGroup = (getGroup: () => DropdownMenuGroup & { items: SolidDropdownMenuEntry[] }) => {
    // Through the accessor throughout, for the reason spelled out above `renderActionItem`.
    const collapsed = createMemo(() => isGroupCollapsed(getGroup()));
    const groupItems = createMemo(() => getGroup().items);

    return (
      <>
        {/* Collapsible header */}
        <Show when={getGroup().collapsible !== false}>
          <we-menu-item
            on:select={() => !getGroup().disabled && toggleGroup(getGroup().id)}
            opacity={getGroup().disabled ? 0.5 : 1}
            cursor={getGroup().disabled ? 'not-allowed' : 'pointer'}
            color="text-faint"
            prop:hoverProps={{ color: 'neutral-500' }}
          >
            <we-icon name={collapsed() ? 'caret-right' : 'caret-down'} size="xs" />
            <we-text>{getGroup().label}</we-text>
          </we-menu-item>
        </Show>

        {/* Non-collapsible header */}
        <Show when={getGroup().collapsible === false}>
          <we-menu-item color="text-muted" cursor="default" pointerEvents="none">
            <we-text>{getGroup().label}</we-text>
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

  const renderBody = (getEntry: () => SolidDropdownMenuEntry) => {
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

  /**
   * An entry that is currently nothing renders nothing — and starts rendering when it stops being
   * nothing.
   *
   * This is what makes a *conditional* item expressible from a schema. `items` is a prop, so an
   * entry can be a `$if`, and a `$if` with no `else` resolves to `undefined` — which arrives here
   * as a hole in the array. Reading `.type` off it threw, so the only way to vary a menu's contents
   * was to abandon the component and hand-roll a `we-menu`, which is what the call bar did for its
   * one conditional toggle.
   *
   * The hole is left **in place** rather than filtered out, and the check is a memo rather than the
   * obvious early `return null`. Both are about `Index`, which keys by position: filtering would
   * shift every later entry into a row built for a different item, and a snapshot taken once at
   * creation would never see the condition change, so the entry would be right at mount and frozen
   * afterwards. A hole holds its index, and the memo re-reads it.
   *
   * `hidden` is the same thing said on the entry: a value expression cannot wrap an entry that
   * carries a handler, so the condition travels on the entry and is read here, by position, exactly
   * as a hole is.
   */
  const renderEntry = (getEntry: () => SolidDropdownMenuEntry) => {
    const present = createMemo(() => {
      const entry = getEntry();
      return Boolean(entry) && !('hidden' in entry && entry.hidden);
    });
    return <Show when={present()}>{renderBody(getEntry)}</Show>;
  };

  /*
    What is written on the trigger.

    The "Options" fallback applies only where there is no glyph either — a trigger with *nothing* on
    it is unusable, so something has to be written. Where an icon was given, an absent label means
    icon-only: it used to mean "icon, followed by the word Options", which is the least informative
    word available for a menu that always has a subject, and every icon-only caller in the repo was
    silently rendering it. An explicit '' still reads as icon-only, as it always did.
  */
  const label = () => (props.triggerIcon ? (props.triggerLabel ?? '') : (props.triggerLabel ?? 'Options'));

  /**
   * A glyph and nothing else — so the trigger is a square, not a pill.
   *
   * Inferred rather than asked for, because the two always travel together: without `square` the
   * size's horizontal padding still applies, and an icon-only trigger comes out wider than it is
   * tall beside every hand-written icon button in the app, all of which pass `square`. There is no
   * caller who wants one glyph in a rounded rectangle.
   */
  const iconOnly = () => Boolean(props.triggerIcon) && !label();

  /*
    The trigger is `we-button`'s own `secondary` — a filled neutral control — rather than the
    hardcoded `bg="surface-active" color="text"` this used to carry over the default `primary`.

    Identical at rest: `controlSurface` was added for exactly this family of things (a secondary
    button, a slider track, a count chip), all of which were borrowing `surfaceActive`, and it was
    given that same value so nothing moved. What changes is the part the override never reached.
    `bg` and `color` were overridden; `hoverProps` and `activeProps` were not, so `primary`'s
    survived the merge and the trigger hovered to the *accent* — beside neighbours going to
    `surfaceHover`, and in a theme where the accent is loud, alarmingly.
  */
  const trigger = (slot: string) => (
    <we-button
      /*
        Required, and `''` rather than omitted where the button is nested inside the tooltip.

        Solid assigns *properties* on a custom element rather than attributes, and `HTMLElement.slot`
        is a non-nullable DOMString: an optional parameter left off writes the string "undefined",
        which names a slot nothing declares, and the trigger silently renders nowhere. `''` is the
        spelling for "the default slot", which is what an omitted `slot` attribute already means.
      */
      slot={slot}
      size={props.size}
      variant={props.triggerVariant ?? 'secondary'}
      square={iconOnly()}
      aria-label={iconOnly() ? (props.triggerTitle ?? 'Options') : undefined}
    >
      <Show when={props.triggerIcon}>
        <we-icon name={props.triggerIcon!} />
      </Show>
      {label()}
    </we-button>
  );

  return (
    <we-popover
      ref={popoverRef}
      class={`we-dropdown-menu ${props.class || ''}`}
      styles={props.styles}
      placement={props.placement || 'bottom'}
      data-we-menu
    >
      {/*
        The tooltip takes the trigger slot and the button sits inside it, rather than the other way
        round: slot assignment considers a shadow host's *direct* children, so whichever element is
        outermost is the one that has to carry `slot`.
      */}
      <Show when={props.triggerTitle} fallback={trigger('trigger')}>
        <we-tooltip slot="trigger" title={props.triggerTitle!} placement="bottom">
          {trigger('')}
        </we-tooltip>
      </Show>

      <we-menu slot="content">
        <Index each={props.items}>{(getEntry) => renderEntry(getEntry)}</Index>
      </we-menu>
    </we-popover>
  );
}
