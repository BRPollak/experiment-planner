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

/** JavaScript weekday numbers in the calendar's custom left-to-right order. */
export const WEEKDAY_ORDER = [6, 1, 2, 3, 4, 5, 0] as const;

/** Offsets within a chronological Monday-through-Sunday week. */
const WEEKDAY_OFFSETS = [5, 0, 1, 2, 3, 4, 6] as const;

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
  const mondayOffset = (firstOfMonth.getDay() + 6) % 7;
  const totalSlots = mondayOffset + lastOfMonth.getDate();
  const weekCount = Math.ceil(totalSlots / 7);
  const firstVisible = new Date(
    firstOfMonth.getFullYear(),
    firstOfMonth.getMonth(),
    firstOfMonth.getDate() - mondayOffset,
  );

  const chronologicalDays = Array.from({ length: weekCount * 7 }, (_, index) => {
    const date = new Date(
      firstVisible.getFullYear(),
      firstVisible.getMonth(),
      firstVisible.getDate() + index,
    );
    return {
      date,
      dateKey: toDateKey(date),
      isCurrentMonth: date.getFullYear() === month.getFullYear()
        && date.getMonth() === month.getMonth(),
    };
  });

  const days = Array.from({ length: weekCount }, (_, weekIndex) => {
    const weekStart = weekIndex * 7;
    return WEEKDAY_OFFSETS.map((offset) => chronologicalDays[weekStart + offset]);
  }).flat();

  return {
    days,
    // Loading still spans the complete chronological Monday-to-Sunday range.
    // The display's first cell is Saturday, so deriving these from `days`
    // would otherwise omit Monday through Friday from the first API query.
    start: chronologicalDays[0].dateKey,
    end: chronologicalDays[chronologicalDays.length - 1].dateKey,
    weekCount,
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
