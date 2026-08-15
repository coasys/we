/**
 * A month, as rows a template can draw.
 *
 * The first `$source`, and the case that motivated the token: a month grid needs to know which
 * weekday the 1st falls on, how many days the month has, and how many leading and trailing cells
 * make up whole weeks. None of that is expressible in the operator set — there is no arithmetic, no
 * date maths, and no way to generate a sequence — so before this, drawing a month meant a component
 * owning every pixel of it.
 *
 * With the days as data, the grid is an ordinary `$each` and a community can render a cell however
 * it likes: a dot, an event chip, a heat-map square. That is the difference between shipping a
 * calendar and letting people build calendars.
 *
 * Pure and synchronous, which is the contract every source keeps. The one impurity worth naming is
 * `isToday`, read from the clock at evaluation — a calendar that did not know today's date would be
 * a strange thing to insist on for purity's sake.
 */

export interface CalendarDay {
  /** `YYYY-MM-DD` — the key a template matches events against. */
  date: string;
  /** Day of the month, 1–31, for the label. */
  day: number;
  /** False for the leading and trailing cells that belong to the neighbouring months. */
  inMonth: boolean;
  isToday: boolean;
  /** 0 = Sunday … 6 = Saturday, for templates that style weekends. */
  weekday: number;
}

export interface CalendarMonthOptions {
  /** Any `YYYY-MM-DD` (or full ISO) inside the month to draw. Defaults to today. */
  month?: string;
  /**
   * Months to step from `month` (or from today) — negative for back.
   *
   * An offset rather than the template computing a new date, because `$setLocal` cannot store a
   * computed value: `from` takes a path and `value` is stored raw. What it *can* do is add to a
   * number, which is the schema layer's one arithmetic operator — so paging a calendar is
   * `{ $setLocal: 'monthOffset', by: 1 }` and every source reads the same offset.
   */
  offset?: number;
  /**
   * Which weekday a row starts on — 0 = Sunday, 1 = Monday. Defaults to Sunday.
   *
   * A prop rather than a locale lookup: the convention is a *community's*, not a browser's, and a
   * template is where a community's conventions belong.
   */
  weekStartsOn?: number;
  /**
   * Always emit six rows, so the grid does not change height between months.
   *
   * Defaults on. A calendar that reflows as you page through it is the sort of small wrongness
   * nobody reports and everybody feels.
   */
  fixedWeeks?: boolean;
}

const pad = (value: number) => String(value).padStart(2, '0');
const iso = (year: number, month: number, day: number) => `${year}-${pad(month + 1)}-${pad(day)}`;

/** Days in a month, leap years included — `day 0` of the next month is the last of this one. */
const daysInMonth = (year: number, month: number) => new Date(year, month + 1, 0).getDate();

/**
 * The month a set of options points at, as a date anchored to the 1st.
 *
 * Anchored deliberately: stepping a month from the 31st lands on the 3rd of March coming out of
 * January, because `setMonth` overflows rather than clamping. That is the classic date bug, and one
 * a template could not work around.
 */
function anchorOf(options: CalendarMonthOptions): Date {
  const parsed = options.month ? new Date(options.month) : new Date();
  // An unparseable `month` would otherwise produce `NaN-NaN-NaN` cells rather than an obvious
  // failure, so fall back to the current month and let the grid still draw.
  const base = Number.isNaN(parsed.getTime()) ? new Date() : parsed;
  return new Date(base.getFullYear(), base.getMonth() + Number(options.offset ?? 0), 1);
}

export function calendarMonth(options: CalendarMonthOptions = {}): CalendarDay[] {
  const base = anchorOf(options);

  const year = base.getFullYear();
  const month = base.getMonth();
  const weekStart = (((options.weekStartsOn ?? 0) % 7) + 7) % 7;

  const today = new Date();
  const todayIso = iso(today.getFullYear(), today.getMonth(), today.getDate());

  // How many cells of the previous month lead the grid, so the 1st lands under its own weekday.
  const firstWeekday = new Date(year, month, 1).getDay();
  const lead = (firstWeekday - weekStart + 7) % 7;

  const total = daysInMonth(year, month);
  const cells: CalendarDay[] = [];

  const push = (cellYear: number, cellMonth: number, cellDay: number, inMonth: boolean) => {
    const date = iso(cellYear, cellMonth, cellDay);
    cells.push({
      date,
      day: cellDay,
      inMonth,
      isToday: date === todayIso,
      weekday: new Date(cellYear, cellMonth, cellDay).getDay(),
    });
  };

  // Leading cells — the tail of the previous month. `new Date(year, month - 1)` handles January
  // rolling back to December of the prior year without a special case.
  const prev = new Date(year, month - 1, 1);
  const prevTotal = daysInMonth(prev.getFullYear(), prev.getMonth());
  for (let index = lead; index > 0; index -= 1) {
    push(prev.getFullYear(), prev.getMonth(), prevTotal - index + 1, false);
  }

  for (let day = 1; day <= total; day += 1) push(year, month, day, true);

  // Trailing cells — enough to complete the last week, and to reach six rows when asked.
  const target = options.fixedWeeks === false ? Math.ceil(cells.length / 7) * 7 : 42;
  const next = new Date(year, month + 1, 1);
  for (let day = 1; cells.length < target; day += 1) {
    push(next.getFullYear(), next.getMonth(), day, false);
  }

  return cells;
}

/**
 * The month a grid is showing, as a heading — "August 2026".
 *
 * A source rather than a `$concat` of parts, because month *names* are a lookup and the schema has
 * no table to look them up in. Locale-aware via `toLocaleString`, which is the one place a browser
 * convention is the right answer: a month's name is a fact about a language, not about a community.
 */
export function monthLabel(options: CalendarMonthOptions = {}): string {
  return anchorOf(options).toLocaleString(undefined, { month: 'long', year: 'numeric' });
}

/** The year a grid is showing, on its own — for a picker that steps years separately. */
export function yearLabel(options: CalendarMonthOptions = {}): string {
  return String(anchorOf(options).getFullYear());
}

/** One month in the jump picker. */
export interface CalendarMonthOption {
  /** Short name, e.g. "Aug". */
  label: string;
  /** 0–11. */
  month: number;
  year: number;
  /**
   * Months from today — what a template writes back to its offset field.
   *
   * The whole reason this source exists. `$setLocal` sets a **literal** value and can only otherwise
   * add a constant, so a picker cannot compute "how far is March 2027 from now". What it *can* do is
   * read a value out of the row it is rendering (`from: '$month.offset'`), so the arithmetic is done
   * here and arrives as data. No new token, and the same trick works for any jump-to control.
   */
  offset: number;
  /** The real current month — worth marking even when the grid is showing a different year. */
  isThisMonth: boolean;
  /** The month the grid is currently on. */
  isShown: boolean;
}

/**
 * The twelve months of whichever year an offset lands in, each carrying its own offset from today.
 *
 * Paired with `yearLabel` and a pair of `by: ±12` buttons, this is a whole jump-to-month picker with
 * no new schema machinery: the year steps by arithmetic the schema already has, and the month is
 * chosen by reading a number out of the row.
 */
export function calendarMonths(options: CalendarMonthOptions = {}): CalendarMonthOption[] {
  const anchor = anchorOf(options);
  const year = anchor.getFullYear();
  const today = new Date();
  const fromToday = (month: number) => (year - today.getFullYear()) * 12 + (month - today.getMonth());

  return Array.from({ length: 12 }, (_, month) => ({
    label: new Date(year, month, 1).toLocaleString(undefined, { month: 'short' }),
    month,
    year,
    offset: fromToday(month),
    isThisMonth: month === today.getMonth() && year === today.getFullYear(),
    isShown: month === anchor.getMonth(),
  }));
}
