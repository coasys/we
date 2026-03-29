export interface TimelineItem {
  label: string;
  description?: string;
  icon?: string;
  timestamp?: string;
}

export interface TimelineProps {
  items?: TimelineItem[];
  styles?: Record<string, string | number>;
}
