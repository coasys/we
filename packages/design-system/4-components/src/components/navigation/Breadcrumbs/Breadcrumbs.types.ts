export interface BreadcrumbItem {
  label: string;
  href?: string;
  icon?: string;
}

export interface BreadcrumbsProps {
  items?: BreadcrumbItem[];
  separator?: string;
  styles?: Record<string, string | number>;
}
