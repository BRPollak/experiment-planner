export interface CalendarDay {
  date: Date;
  dateKey: string;
  isCurrentMonth: boolean;
}

export interface CalendarRange {
  days: CalendarDay[];
  start: string;
  end: string;
  weekCount: number;
}

export const WEEKDAYS = [
  "Saturday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Sunday",
] as const;

/** JavaScript weekday numbers in the calendar's weekend-bookend order. */
export const WEEKDAY_ORDER = [6, 1, 2, 3, 4, 5, 0] as const;

/**
 * Offsets from the Monday represented by a visual row. The Saturday is the
 * one before that Monday, preventing a later Saturday from preceding earlier
 * weekdays as it did in the original custom layout.
 */
const WEEKDAY_OFFSETS = [-2, 0, 1, 2, 3, 4, 6] as const;

function addLocalDays(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

function visualRowMonday(date: Date): Date {
  const weekday = date.getDay();
  if (weekday === 6) return addLocalDays(date, 2);
  if (weekday === 0) return addLocalDays(date, -6);
  return addLocalDays(date, 1 - weekday);
}

export function toDateKey(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

export function fromDateKey(value: string): Date {
  const [year, month, day] = value.split("-").map(Number);
  return new Date(year, month - 1, day);
}

export function getCalendarRange(month: Date): CalendarRange {
  const firstOfMonth = new Date(month.getFullYear(), month.getMonth(), 1);
  const lastOfMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const monthDays = Array.from(
    { length: lastOfMonth.getDate() },
    (_, index) => addLocalDays(firstOfMonth, index),
  );
  const rowMondays = monthDays.map(visualRowMonday);
  const firstRowMonday = rowMondays.reduce((earliest, candidate) => (
    candidate.getTime() < earliest.getTime() ? candidate : earliest
  ));
  const lastRowMonday = rowMondays.reduce((latest, candidate) => (
    candidate.getTime() > latest.getTime() ? candidate : latest
  ));

  const visibleRowMondays: Date[] = [];
  for (
    let rowMonday = firstRowMonday;
    rowMonday.getTime() <= lastRowMonday.getTime();
    rowMonday = addLocalDays(rowMonday, 7)
  ) {
    visibleRowMondays.push(rowMonday);
  }

  const days = visibleRowMondays.flatMap((rowMonday) => (
    WEEKDAY_OFFSETS.map((offset) => {
      const date = addLocalDays(rowMonday, offset);
      return {
        date,
        dateKey: toDateKey(date),
        isCurrentMonth: date.getFullYear() === month.getFullYear()
          && date.getMonth() === month.getMonth(),
      };
    })
  ));

  return {
    days,
    // API loading spans the true chronological bounds even though the final
    // Sunday appears immediately before the next row's leading Saturday.
    start: toDateKey(addLocalDays(firstRowMonday, WEEKDAY_OFFSETS[0])),
    end: toDateKey(addLocalDays(lastRowMonday, WEEKDAY_OFFSETS.at(-1)!)),
    weekCount: visibleRowMondays.length,
  };
}

export function shiftMonth(month: Date, delta: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + delta, 1);
}

export function monthHeading(month: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(month);
}

export function friendlyDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(fromDateKey(value));
}
