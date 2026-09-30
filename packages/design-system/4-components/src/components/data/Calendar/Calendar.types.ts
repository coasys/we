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
  /**
   * The day that was clicked, as `YYYY-MM-DD`.
   *
   * Part of the public contract rather than a Solid-only extra: a grid you cannot pick a day in is
   * a picture of a month, and the obvious thing to do with a calendar full of dots is to ask what
   * is on one of them. It was already implemented and reachable only from framework code, so no
   * schema could wire it.
   */
  onSelect?: (date: string) => void;
  styles?: Record<string, string | number>;
}
