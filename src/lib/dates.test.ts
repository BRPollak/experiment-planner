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

function assertChronologicalWeekRows(month: Date): void {
  const range = getCalendarRange(month);
  assert.equal(range.days.length, range.weekCount * 7);
  assert.equal(new Set(range.days.map(({ dateKey }) => dateKey)).size, range.days.length);

  rows(range.days).forEach((week) => {
    assert.deepEqual(week.map(({ date }) => date.getDay()), [...WEEKDAY_ORDER]);
    assert.deepEqual(
      week.map(({ dateKey }) => dateKey),
      Array.from({ length: 7 }, (_, offset) => toDateKey(addLocalDays(week[0].date, offset))),
    );
  });

  range.days.slice(1).forEach((day, index) => {
    assert.equal(day.dateKey, toDateKey(addLocalDays(range.days[index].date, 1)));
  });
  assert.equal(range.start, range.days[0].dateKey);
  assert.equal(range.end, range.days[range.days.length - 1].dateKey);
}

test("weekday headings run chronologically from Monday through Sunday", () => {
  assert.deepEqual([...WEEKDAYS], [
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Saturday",
    "Sunday",
  ]);
});

test("August 2026 stays in ascending order across the reported Saturday-to-Monday defect", () => {
  const range = getCalendarRange(new Date(2026, 7, 1));

  assert.equal(range.start, "2026-07-27");
  assert.equal(range.end, "2026-09-06");
  assert.equal(range.weekCount, 6);
  assert.deepEqual(range.days.slice(0, 7).map(({ dateKey }) => dateKey), [
    "2026-07-27",
    "2026-07-28",
    "2026-07-29",
    "2026-07-30",
    "2026-07-31",
    "2026-08-01",
    "2026-08-02",
  ]);
  assert.deepEqual(range.days.slice(14, 21).map(({ dateKey }) => dateKey), [
    "2026-08-10",
    "2026-08-11",
    "2026-08-12",
    "2026-08-13",
    "2026-08-14",
    "2026-08-15",
    "2026-08-16",
  ]);
  assert.deepEqual(range.days.slice(-7).map(({ dateKey }) => dateKey), [
    "2026-08-31",
    "2026-09-01",
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
    "2026-09-05",
    "2026-09-06",
  ]);
  assertChronologicalWeekRows(new Date(2026, 7, 1));
});

test("a month beginning Sunday keeps that Sunday at the end of the preceding Monday-based week", () => {
  const range = getCalendarRange(new Date(2024, 8, 1));

  assert.equal(range.start, "2024-08-26");
  assert.equal(range.end, "2024-10-06");
  assert.deepEqual(range.days.slice(0, 7).map(({ dateKey }) => dateKey), [
    "2024-08-26",
    "2024-08-27",
    "2024-08-28",
    "2024-08-29",
    "2024-08-30",
    "2024-08-31",
    "2024-09-01",
  ]);
  assert.equal(range.days[6].isCurrentMonth, true);
  assertChronologicalWeekRows(new Date(2024, 8, 1));
});

test("a four-week month still uses complete chronological Monday-through-Sunday rows", () => {
  const range = getCalendarRange(new Date(2021, 1, 1));

  assert.equal(range.weekCount, 4);
  assert.equal(range.start, "2021-02-01");
  assert.equal(range.end, "2021-02-28");
  assert.deepEqual(range.days.slice(0, 7).map(({ dateKey }) => dateKey), [
    "2021-02-01",
    "2021-02-02",
    "2021-02-03",
    "2021-02-04",
    "2021-02-05",
    "2021-02-06",
    "2021-02-07",
  ]);
  assertChronologicalWeekRows(new Date(2021, 1, 1));
});

test("December maps correctly across the year boundary", () => {
  const range = getCalendarRange(new Date(2025, 11, 1));

  assert.equal(range.start, "2025-12-01");
  assert.equal(range.end, "2026-01-04");
  assert.deepEqual(range.days.slice(-7).map(({ dateKey }) => dateKey), [
    "2025-12-29",
    "2025-12-30",
    "2025-12-31",
    "2026-01-01",
    "2026-01-02",
    "2026-01-03",
    "2026-01-04",
  ]);
  assert.deepEqual(range.days.slice(-7).map(({ isCurrentMonth }) => isCurrentMonth), [
    true,
    true,
    true,
    false,
    false,
    false,
    false,
  ]);
  assertChronologicalWeekRows(new Date(2025, 11, 1));
});

test("leap-year February includes February 29 beneath Thursday", () => {
  const range = getCalendarRange(new Date(2024, 1, 1));
  const leapDayIndex = range.days.findIndex(({ dateKey }) => dateKey === "2024-02-29");

  assert.equal(range.start, "2024-01-29");
  assert.equal(range.end, "2024-03-03");
  assert.notEqual(leapDayIndex, -1);
  assert.equal(leapDayIndex % 7, 3);
  assert.equal(range.days[leapDayIndex].date.getDay(), 4);
  assert.equal(range.days[leapDayIndex].isCurrentMonth, true);
  assertChronologicalWeekRows(new Date(2024, 1, 1));
});

test("months beginning and ending on different weekdays retain weekday identity", () => {
  const weekdayColumns: readonly number[] = WEEKDAY_ORDER;
  const cases = [
    new Date(2024, 4, 1),
    new Date(2024, 9, 1),
    new Date(2026, 0, 1),
    new Date(2026, 3, 1),
    new Date(2026, 4, 1),
    new Date(2026, 5, 1),
    new Date(2026, 7, 1),
    new Date(2026, 10, 1),
  ];

  cases.forEach((month) => {
    const range = getCalendarRange(month);
    const currentMonthDays = range.days.filter(({ isCurrentMonth }) => isCurrentMonth);
    const lastOfMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0);
    const first = currentMonthDays.find(({ date }) => date.getDate() === 1);
    const last = currentMonthDays.find(({ date }) => date.getDate() === lastOfMonth.getDate());

    assert.equal(first?.date.getDay(), new Date(month.getFullYear(), month.getMonth(), 1).getDay());
    assert.equal(last?.date.getDay(), lastOfMonth.getDay());
    assert.equal(range.days.indexOf(first!) % 7, weekdayColumns.indexOf(first!.date.getDay()));
    assert.equal(range.days.indexOf(last!) % 7, weekdayColumns.indexOf(last!.date.getDay()));
    assertChronologicalWeekRows(month);
  });
});
