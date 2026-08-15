import assert from "node:assert/strict";
import test from "node:test";

import {
  getCalendarRange,
  toDateKey,
  WEEKDAY_ORDER,
  WEEKDAYS,
  type CalendarDay,
} from "./dates";

function addLocalDays(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

function rows(days: CalendarDay[]): CalendarDay[][] {
  return Array.from({ length: days.length / 7 }, (_, index) => (
    days.slice(index * 7, index * 7 + 7)
  ));
}

function assertChronologicalSundayRows(month: Date): void {
  const range = getCalendarRange(month);
  assert.equal(range.days.length, range.weekCount * 7);
  assert.equal(new Set(range.days.map(({ dateKey }) => dateKey)).size, range.days.length);
  assert.equal(range.days[0].date.getDay(), 0);
  assert.equal(range.days[range.days.length - 1].date.getDay(), 6);

  range.days.forEach((day, index) => {
    assert.equal(day.dateKey, toDateKey(addLocalDays(range.days[0].date, index)));
  });
  rows(range.days).forEach((week) => {
    assert.deepEqual(week.map(({ date }) => date.getDay()), [...WEEKDAY_ORDER]);
  });

  const expectedCurrentMonth = Array.from(
    { length: new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate() },
    (_, index) => toDateKey(new Date(month.getFullYear(), month.getMonth(), index + 1)),
  );
  assert.deepEqual(
    range.days.filter(({ isCurrentMonth }) => isCurrentMonth).map(({ dateKey }) => dateKey),
    expectedCurrentMonth,
  );
  assert.equal(range.start, range.days[0].dateKey);
  assert.equal(range.end, range.days[range.days.length - 1].dateKey);
}

test("weekday headings run chronologically from Sunday through Saturday", () => {
  assert.deepEqual([...WEEKDAYS], [
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
  ]);
  assert.deepEqual([...WEEKDAY_ORDER], [0, 1, 2, 3, 4, 5, 6]);
});

test("a month beginning Saturday includes the preceding Sunday and stays chronological", () => {
  const range = getCalendarRange(new Date(2026, 7, 1));

  assert.equal(range.start, "2026-07-26");
  assert.equal(range.end, "2026-09-05");
  assert.equal(range.weekCount, 6);
  assert.deepEqual(range.days.slice(0, 7).map(({ dateKey }) => dateKey), [
    "2026-07-26",
    "2026-07-27",
    "2026-07-28",
    "2026-07-29",
    "2026-07-30",
    "2026-07-31",
    "2026-08-01",
  ]);
  assert.deepEqual(range.days.slice(14, 21).map(({ dateKey }) => dateKey), [
    "2026-08-09",
    "2026-08-10",
    "2026-08-11",
    "2026-08-12",
    "2026-08-13",
    "2026-08-14",
    "2026-08-15",
  ]);
  assert.deepEqual(range.days.slice(-7).map(({ dateKey }) => dateKey), [
    "2026-08-30",
    "2026-08-31",
    "2026-09-01",
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
    "2026-09-05",
  ]);
  assertChronologicalSundayRows(new Date(2026, 7, 1));
});

test("a month beginning Sunday starts directly on day one", () => {
  const range = getCalendarRange(new Date(2024, 8, 1));

  assert.equal(range.start, "2024-09-01");
  assert.equal(range.end, "2024-10-05");
  assert.equal(range.weekCount, 5);
  assert.deepEqual(range.days.slice(0, 7).map(({ dateKey }) => dateKey), [
    "2024-09-01",
    "2024-09-02",
    "2024-09-03",
    "2024-09-04",
    "2024-09-05",
    "2024-09-06",
    "2024-09-07",
  ]);
  assert.equal(range.days[0].isCurrentMonth, true);
  assertChronologicalSundayRows(new Date(2024, 8, 1));
});

test("February 2015 fits exactly four Sunday-through-Saturday rows", () => {
  const range = getCalendarRange(new Date(2015, 1, 1));

  assert.equal(range.weekCount, 4);
  assert.equal(range.start, "2015-02-01");
  assert.equal(range.end, "2015-02-28");
  assertChronologicalSundayRows(new Date(2015, 1, 1));
});

test("October 2021 expands to six complete chronological rows", () => {
  const range = getCalendarRange(new Date(2021, 9, 1));

  assert.equal(range.weekCount, 6);
  assert.equal(range.start, "2021-09-26");
  assert.equal(range.end, "2021-11-06");
  assertChronologicalSundayRows(new Date(2021, 9, 1));
});

test("December maps correctly across the year boundary", () => {
  const range = getCalendarRange(new Date(2025, 11, 1));

  assert.equal(range.start, "2025-11-30");
  assert.equal(range.end, "2026-01-03");
  assert.deepEqual(range.days.slice(-7).map(({ dateKey }) => dateKey), [
    "2025-12-28",
    "2025-12-29",
    "2025-12-30",
    "2025-12-31",
    "2026-01-01",
    "2026-01-02",
    "2026-01-03",
  ]);
  assertChronologicalSundayRows(new Date(2025, 11, 1));
});

test("leap-year February includes February 29 beneath Thursday", () => {
  const range = getCalendarRange(new Date(2024, 1, 1));
  const leapDayIndex = range.days.findIndex(({ dateKey }) => dateKey === "2024-02-29");

  assert.equal(range.start, "2024-01-28");
  assert.equal(range.end, "2024-03-02");
  assert.notEqual(leapDayIndex, -1);
  assert.equal(leapDayIndex % 7, 4);
  assert.equal(range.days[leapDayIndex].date.getDay(), 4);
  assert.equal(range.days[leapDayIndex].isCurrentMonth, true);
  assertChronologicalSundayRows(new Date(2024, 1, 1));
});

test("local dates stay consecutive through spring and fall daylight-saving transitions", () => {
  const originalTimeZone = process.env.TZ;
  process.env.TZ = "America/Los_Angeles";
  try {
    const spring = getCalendarRange(new Date(2026, 2, 1));
    const fall = getCalendarRange(new Date(2026, 10, 1));

    assert.notEqual(
      spring.days[0].date.getTimezoneOffset(),
      spring.days[spring.days.length - 1].date.getTimezoneOffset(),
    );
    assert.notEqual(
      fall.days[0].date.getTimezoneOffset(),
      fall.days[fall.days.length - 1].date.getTimezoneOffset(),
    );
    assertChronologicalSundayRows(new Date(2026, 2, 1));
    assertChronologicalSundayRows(new Date(2026, 10, 1));
  } finally {
    if (originalTimeZone === undefined) delete process.env.TZ;
    else process.env.TZ = originalTimeZone;
  }
});

test("every month from 2000 through 2100 stays chronological and complete", () => {
  for (let year = 2000; year <= 2100; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      assertChronologicalSundayRows(new Date(year, month, 1));
    }
  }
});
