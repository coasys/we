import { Accessor, For, JSX, Show } from 'solid-js';

export interface PopoverToggleMenuItem {
  id: string;
  label: string;
  icon?: string;
  checked: Accessor<boolean> | boolean;
  onToggle?: () => void;
  disabled?: boolean;
}

export interface PopoverToggleMenuProps {
  items: PopoverToggleMenuItem[];
  triggerLabel?: string;
  triggerIcon?: string;
  class?: string;
  styles?: JSX.CSSProperties;
}

/**
 * PopoverToggleMenu
 *
 * A menu with checkbox-style items for toggling multiple options.
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
 *   ]}
 * />
 * ```
 */
export function PopoverToggleMenu(props: PopoverToggleMenuProps) {
  let popoverRef: HTMLElement | undefined;

  // Debug logging
  console.log('PopoverToggleMenu props:', props);
  console.log('PopoverToggleMenu items:', props.items);
  console.log('PopoverToggleMenu items length:', props.items?.length);
  console.log('PopoverToggleMenu items type:', typeof props.items, Array.isArray(props.items));

  const handleToggle = (item: PopoverToggleMenuItem) => {
    if (item.disabled) return;
    item.onToggle?.();
  };

  const isChecked = (item: PopoverToggleMenuItem): boolean => {
    return typeof item.checked === 'function' ? item.checked() : item.checked;
  };

  return (
    <we-popover
      ref={popoverRef}
      class={`we-popover-toggle-menu ${props.class || ''}`}
      styles={props.styles}
      placement="bottom-end"
      data-we-menu
    >
      <we-button slot="trigger" bg="ui-200" color="ui-800">
        <Show when={props.triggerIcon}>
          <we-icon name={props.triggerIcon!} />
        </Show>
        {props.triggerLabel || 'Options'}
      </we-button>

      <we-menu slot="content">
        <For each={props.items}>
          {(item) => (
            <we-menu-item
              onClick={() => handleToggle(item)}
              selected={isChecked(item)}
              style={{
                opacity: item.disabled ? '0.5' : '1',
                cursor: item.disabled ? 'not-allowed' : 'pointer',
              }}
            >
              <Show when={item.icon}>
                <we-icon slot="start" name={item.icon!} />
              </Show>
              <span style={{ flex: 1 }}>{item.label}</span>
              <Show when={isChecked(item)}>
                <we-icon slot="end" name="check" />
              </Show>
            </we-menu-item>
          )}
        </For>
      </we-menu>
    </we-popover>
  );
}
