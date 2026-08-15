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

function assertChronologicalSaturdayRows(month: Date): void {
  const range = getCalendarRange(month);
  assert.equal(range.days.length, range.weekCount * 7);
  assert.equal(new Set(range.days.map(({ dateKey }) => dateKey)).size, range.days.length);

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

test("weekday headings run chronologically from Saturday through Friday", () => {
  assert.deepEqual([...WEEKDAYS], [
    "Saturday",
    "Sunday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
  ]);
});

test("August 2026 is chronological with Sunday immediately after Saturday", () => {
  const range = getCalendarRange(new Date(2026, 7, 1));

  assert.equal(range.start, "2026-08-01");
  assert.equal(range.end, "2026-09-04");
  assert.equal(range.weekCount, 5);
  assert.deepEqual(range.days.slice(0, 7).map(({ dateKey }) => dateKey), [
    "2026-08-01",
    "2026-08-02",
    "2026-08-03",
    "2026-08-04",
    "2026-08-05",
    "2026-08-06",
    "2026-08-07",
  ]);
  assert.deepEqual(range.days.slice(14, 21).map(({ dateKey }) => dateKey), [
    "2026-08-15",
    "2026-08-16",
    "2026-08-17",
    "2026-08-18",
    "2026-08-19",
    "2026-08-20",
    "2026-08-21",
  ]);
  assert.deepEqual(range.days.slice(-7).map(({ dateKey }) => dateKey), [
    "2026-08-29",
    "2026-08-30",
    "2026-08-31",
    "2026-09-01",
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
  ]);
  assertChronologicalSaturdayRows(new Date(2026, 7, 1));
});

test("a month beginning Sunday follows the preceding Saturday", () => {
  const range = getCalendarRange(new Date(2024, 8, 1));

  assert.equal(range.start, "2024-08-31");
  assert.equal(range.end, "2024-10-04");
  assert.equal(range.weekCount, 5);
  assert.deepEqual(range.days.slice(0, 7).map(({ dateKey }) => dateKey), [
    "2024-08-31",
    "2024-09-01",
    "2024-09-02",
    "2024-09-03",
    "2024-09-04",
    "2024-09-05",
    "2024-09-06",
  ]);
  assert.equal(range.days[1].isCurrentMonth, true);
  assertChronologicalSaturdayRows(new Date(2024, 8, 1));
});

test("February 2014 fits exactly four Saturday-through-Friday rows", () => {
  const range = getCalendarRange(new Date(2014, 1, 1));

  assert.equal(range.weekCount, 4);
  assert.equal(range.start, "2014-02-01");
  assert.equal(range.end, "2014-02-28");
  assertChronologicalSaturdayRows(new Date(2014, 1, 1));
});

test("October 2021 expands to six complete chronological rows", () => {
  const range = getCalendarRange(new Date(2021, 9, 1));

  assert.equal(range.weekCount, 6);
  assert.equal(range.start, "2021-09-25");
  assert.equal(range.end, "2021-11-05");
  assertChronologicalSaturdayRows(new Date(2021, 9, 1));
});

test("December maps correctly across the year boundary", () => {
  const range = getCalendarRange(new Date(2025, 11, 1));

  assert.equal(range.start, "2025-11-29");
  assert.equal(range.end, "2026-01-02");
  assert.deepEqual(range.days.slice(-7).map(({ dateKey }) => dateKey), [
    "2025-12-27",
    "2025-12-28",
    "2025-12-29",
    "2025-12-30",
    "2025-12-31",
    "2026-01-01",
    "2026-01-02",
  ]);
  assertChronologicalSaturdayRows(new Date(2025, 11, 1));
});

test("leap-year February includes February 29 beneath Thursday", () => {
  const range = getCalendarRange(new Date(2024, 1, 1));
  const leapDayIndex = range.days.findIndex(({ dateKey }) => dateKey === "2024-02-29");

  assert.equal(range.start, "2024-01-27");
  assert.equal(range.end, "2024-03-01");
  assert.notEqual(leapDayIndex, -1);
  assert.equal(leapDayIndex % 7, 5);
  assert.equal(range.days[leapDayIndex].date.getDay(), 4);
  assert.equal(range.days[leapDayIndex].isCurrentMonth, true);
  assertChronologicalSaturdayRows(new Date(2024, 1, 1));
});

test("local dates stay consecutive through spring and fall daylight-saving transitions", () => {
  assertChronologicalSaturdayRows(new Date(2026, 2, 1));
  assertChronologicalSaturdayRows(new Date(2026, 10, 1));
});

test("every month from 2000 through 2100 stays chronological and complete", () => {
  for (let year = 2000; year <= 2100; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      assertChronologicalSaturdayRows(new Date(year, month, 1));
    }
  }
});
