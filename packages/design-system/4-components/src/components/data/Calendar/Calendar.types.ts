export interface CalendarEvent {
  id?: string;
  /**
   * ISO `YYYY-MM-DD`, or a full datetime — anything past the tenth character is ignored.
   *
   * Both, because every event model in this system stores a datetime (`EventBlock.startDate` feeds
   * a `datetime-local` input) while the grid's cells are days, and a schema has no string operator
   * to truncate one into the other.
   */
  date: string;
  label: string;
  color?: string;
}

export interface CalendarProps {
  value?: string; // ISO YYYY-MM-DD
  events?: CalendarEvent[];
  styles?: Record<string, string | number>;
}
