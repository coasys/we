export interface CalendarEvent {
  id?: string;
  date: string; // ISO YYYY-MM-DD
  label: string;
  color?: string;
}

export interface CalendarProps {
  value?: string; // ISO YYYY-MM-DD
  events?: CalendarEvent[];
  styles?: Record<string, string | number>;
}
