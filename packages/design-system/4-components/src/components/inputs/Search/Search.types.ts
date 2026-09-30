export interface SearchProps {
  placeholder?: string;
  value?: string;
  onSearch?: (value: string) => void;
  debounce?: number;
  class?: string;
  styles?: Record<string, string | number>;
}
