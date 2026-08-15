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
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
] as const;

/** JavaScript weekday numbers in chronological Saturday-through-Friday order. */
export const WEEKDAY_ORDER = [6, 0, 1, 2, 3, 4, 5] as const;

function addLocalDays(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
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
  const leadingDayCount = (firstOfMonth.getDay() + 1) % 7;
  const weekCount = Math.ceil((leadingDayCount + lastOfMonth.getDate()) / 7);
  const firstVisible = addLocalDays(firstOfMonth, -leadingDayCount);
  const days = Array.from({ length: weekCount * 7 }, (_, index) => {
    const date = addLocalDays(firstVisible, index);
    return {
      date,
      dateKey: toDateKey(date),
      isCurrentMonth: date.getFullYear() === month.getFullYear()
        && date.getMonth() === month.getMonth(),
    };
  });

  return {
    days,
    start: days[0].dateKey,
    end: days[days.length - 1].dateKey,
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
