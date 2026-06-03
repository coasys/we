export interface ListItem {
  id?: string;
  label: string;
  description?: string;
  icon?: string;
}

export interface ListProps {
  items?: ListItem[];
  ordered?: boolean;
  gap?: string;
  styles?: Record<string, string | number>;
}
