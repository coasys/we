export interface ComboboxOption {
  label: string;
  value: string;
}

export interface ComboboxProps {
  /** String shorthand (label === value) or full {label, value} pairs */
  options: string[] | ComboboxOption[];
  value?: string;
  placeholder?: string;
  size?: 'xs' | 'sm' | 'md' | 'lg' | 'xl';
  onChange?: (value: string) => void;
}
