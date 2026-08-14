import { createSignal, For } from 'solid-js';

export type * from './Calendar.types';
import type { CalendarProps } from './Calendar.types';

const DAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];

interface SolidCalendarProps extends CalendarProps {
  onSelect?: (date: string) => void;
}

export function Calendar(props: SolidCalendarProps) {
  const today = new Date();
  const todayStr = formatDate(today.getFullYear(), today.getMonth(), today.getDate());

  const [viewYear, setViewYear] = createSignal(props.value ? new Date(props.value).getFullYear() : today.getFullYear());
  const [viewMonth, setViewMonth] = createSignal(props.value ? new Date(props.value).getMonth() : today.getMonth());

  const prevMonth = () => {
    if (viewMonth() === 0) {
      setViewMonth(11);
      setViewYear((y) => y - 1);
    } else {
      setViewMonth((m) => m - 1);
    }
  };

  const nextMonth = () => {
    if (viewMonth() === 11) {
      setViewMonth(0);
      setViewYear((y) => y + 1);
    } else {
      setViewMonth((m) => m + 1);
    }
  };

  const selectDate = (year: number, month: number, day: number) => {
    const date = formatDate(year, month, day);
    props.onSelect?.(date);
  };

  /**
   * The days that have something on them.
   *
   * Dates are truncated to `YYYY-MM-DD` before comparing, so an event may carry either a date or a
   * full ISO datetime. Grid cells are date-only, so an exact match against `2026-08-15T14:00` never
   * fired — and the caller could not fix it either, since a schema has no string operator to slice
   * with. Every model in this system stores event times as datetimes, so accepting only date-only
   * strings made the component unusable by exactly the data it exists to draw.
   */
  const eventDates = () => {
    const set = new Set<string>();
    (props.events || []).forEach((e) => e.date && set.add(e.date.slice(0, 10)));
    return set;
  };

  const getDays = () => {
    const y = viewYear();
    const m = viewMonth();
    const firstDay = new Date(y, m, 1).getDay();
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const daysInPrev = new Date(y, m, 0).getDate();

    const cells: { day: number; month: number; year: number; otherMonth: boolean }[] = [];

    for (let i = firstDay - 1; i >= 0; i--) {
      const pm = m === 0 ? 11 : m - 1;
      const py = m === 0 ? y - 1 : y;
      cells.push({ day: daysInPrev - i, month: pm, year: py, otherMonth: true });
    }

    for (let i = 1; i <= daysInMonth; i++) {
      cells.push({ day: i, month: m, year: y, otherMonth: false });
    }

    const remaining = 42 - cells.length;
    for (let i = 1; i <= remaining; i++) {
      const nm = m === 11 ? 0 : m + 1;
      const ny = m === 11 ? y + 1 : y;
      cells.push({ day: i, month: nm, year: ny, otherMonth: true });
    }

    return cells;
  };

  const monthLabel = () =>
    new Date(viewYear(), viewMonth()).toLocaleString(undefined, { month: 'long', year: 'numeric' });

  return (
    <div class="we-calendar" style={props.styles}>
      <div class="we-calendar__header">
        <button class="we-calendar__nav" onClick={prevMonth} aria-label="Previous month">
          <we-icon name="caret-left" size="14px" />
        </button>
        <span>{monthLabel()}</span>
        <button class="we-calendar__nav" onClick={nextMonth} aria-label="Next month">
          <we-icon name="caret-right" size="14px" />
        </button>
      </div>
      <div class="we-calendar__grid" role="grid">
        <For each={DAYS}>{(d) => <span class="we-calendar__day-header">{d}</span>}</For>
        <For each={getDays()}>
          {(cell) => {
            const dateStr = () => formatDate(cell.year, cell.month, cell.day);
            const isSelected = () => props.value === dateStr();
            const isToday = () => dateStr() === todayStr;
            const hasEvents = () => eventDates().has(dateStr());

            const classes = () => {
              let c = 'we-calendar__day';
              if (isSelected()) c += ' we-calendar__day--selected';
              if (isToday()) c += ' we-calendar__day--today';
              if (cell.otherMonth) c += ' we-calendar__day--other-month';
              if (hasEvents()) c += ' we-calendar__day--has-events';
              return c;
            };

            return (
              <button class={classes()} onClick={() => selectDate(cell.year, cell.month, cell.day)}>
                {cell.day}
              </button>
            );
          }}
        </For>
      </div>
    </div>
  );
}

function formatDate(year: number, month: number, day: number): string {
  const m = String(month + 1).padStart(2, '0');
  const d = String(day).padStart(2, '0');
  return `${year}-${m}-${d}`;
}
