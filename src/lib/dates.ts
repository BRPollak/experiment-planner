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
  "Sunday",
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
] as const;

/** JavaScript weekday numbers in chronological Sunday-through-Saturday order. */
export const WEEKDAY_ORDER = [0, 1, 2, 3, 4, 5, 6] as const;

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
  const leadingDayCount = firstOfMonth.getDay();
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

export function getWeekRange(referenceDate: Date): CalendarRange {
  const referenceWeekday = referenceDate.getDay() as (typeof WEEKDAY_ORDER)[number];
  const referenceDayIndex = WEEKDAY_ORDER.indexOf(referenceWeekday);
  const firstVisible = addLocalDays(referenceDate, -referenceDayIndex);
  const days = WEEKDAY_ORDER.map((_, index) => {
    const date = addLocalDays(firstVisible, index);
    return {
      date,
      dateKey: toDateKey(date),
      isCurrentMonth: date.getFullYear() === referenceDate.getFullYear()
        && date.getMonth() === referenceDate.getMonth(),
    };
  });

  return {
    days,
    start: days[0].dateKey,
    end: days[days.length - 1].dateKey,
    weekCount: 1,
  };
}

export function shiftMonth(month: Date, delta: number): Date {
  return new Date(month.getFullYear(), month.getMonth() + delta, 1);
}

export function shiftWeek(referenceDate: Date, delta: number): Date {
  return addLocalDays(referenceDate, delta * WEEKDAY_ORDER.length);
}

export function monthHeading(month: Date): string {
  return new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  }).format(month);
}

export function weekHeading(referenceDate: Date): string {
  const { days } = getWeekRange(referenceDate);
  const firstDay = days[0].date;
  const lastDay = days[days.length - 1].date;
  const month = new Intl.DateTimeFormat(undefined, { month: "long" });
  const monthAndYear = new Intl.DateTimeFormat(undefined, {
    month: "long",
    year: "numeric",
  });

  if (
    firstDay.getFullYear() === lastDay.getFullYear()
    && firstDay.getMonth() === lastDay.getMonth()
  ) {
    return monthAndYear.format(firstDay);
  }

  if (firstDay.getFullYear() === lastDay.getFullYear()) {
    return `${month.format(firstDay)} – ${monthAndYear.format(lastDay)}`;
  }

  return `${monthAndYear.format(firstDay)} – ${monthAndYear.format(lastDay)}`;
}

export function friendlyDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    weekday: "long",
    month: "long",
    day: "numeric",
    year: "numeric",
  }).format(fromDateKey(value));
}
