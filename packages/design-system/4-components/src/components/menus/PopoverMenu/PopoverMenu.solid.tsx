export type * from './PopoverMenu.types';
import type { PopoverMenuProps } from './PopoverMenu.types';

type Option = { id: string; name: string; icon: string };

export function PopoverMenu<T extends Option>(props: PopoverMenuProps<T>) {
  let popoverRef: HTMLElement | undefined;

  const handleSelect = (option: T) => {
    // Call the onSelect callback with the chosen option
    props.onSelect(option);

    // Close the popover after selection
    popoverRef?.removeAttribute('open');
  };

  return (
    <we-popover
      ref={popoverRef}
      class={`we-popover-menu ${props.class || ''}`}
      styles={props.styles}
      placement="bottom-end"
      data-we-menu
    >
      <we-button slot="trigger" bg="neutral-100" color="neutral-1000" r="pill">
        <we-icon name={props.selectedOption.icon} />
        {props.selectedOption.name}
      </we-button>

      <we-menu slot="content">
        {props.options.map((option) => (
          <we-menu-item key={option.name} onClick={() => handleSelect(option)}>
            <we-icon slot="start" name={option.icon} />
            {option.name}
          </we-menu-item>
        ))}
      </we-menu>
    </we-popover>
  );
}
