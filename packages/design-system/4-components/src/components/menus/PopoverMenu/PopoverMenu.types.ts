type Option = { id: string; name: string; icon: string };

/**
 * @ai Dropdown menu that shows a list of selectable options in a popover.
 * Each option has an id, name, and icon. The selected option is highlighted.
 * Generic over option type — consumers can extend `{ id, name, icon }`.
 */
export interface PopoverMenuProps<T extends Option = Option> {
  options: T[];
  selectedOption: T;
  onSelect: (option: T) => void;
  class?: string;
  styles?: Record<string, string | number>;
}
