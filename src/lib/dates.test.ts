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

function assertCustomWeekRows(month: Date): void {
  const range = getCalendarRange(month);
  assert.equal(range.days.length, range.weekCount * 7);
  assert.equal(new Set(range.days.map(({ dateKey }) => dateKey)).size, range.days.length);

  rows(range.days).forEach((week) => {
    assert.deepEqual(week.map(({ date }) => date.getDay()), [...WEEKDAY_ORDER]);
    const monday = week[1].date;
    const offsetsFromMonday = [5, 0, 1, 2, 3, 4, 6];
    assert.deepEqual(
      week.map(({ dateKey }) => dateKey),
      offsetsFromMonday.map((offset) => toDateKey(addLocalDays(monday, offset))),
    );
  });

  const chronologicalKeys = range.days.map(({ dateKey }) => dateKey).sort();
  assert.equal(range.start, chronologicalKeys[0]);
  assert.equal(range.end, chronologicalKeys[chronologicalKeys.length - 1]);
}

test("weekday headings use the exact custom labels", () => {
  assert.deepEqual([...WEEKDAYS], [
    "Saturday",
    "Monday",
    "Tuesday",
    "Wednesday",
    "Thursday",
    "Friday",
    "Sunday",
  ]);
});

test("a month beginning Saturday places dates in custom columns without shortening its API range", () => {
  const range = getCalendarRange(new Date(2026, 7, 1));

  assert.equal(range.start, "2026-07-27");
  assert.equal(range.end, "2026-09-06");
  assert.equal(range.weekCount, 6);
  assert.deepEqual(range.days.slice(0, 7).map(({ dateKey }) => dateKey), [
    "2026-08-01",
    "2026-07-27",
    "2026-07-28",
    "2026-07-29",
    "2026-07-30",
    "2026-07-31",
    "2026-08-02",
  ]);
  assert.deepEqual(range.days.slice(-7).map(({ dateKey }) => dateKey), [
    "2026-09-05",
    "2026-08-31",
    "2026-09-01",
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
    "2026-09-06",
  ]);
  assertCustomWeekRows(new Date(2026, 7, 1));
});

test("a month beginning Sunday keeps that Sunday in the preceding Monday-based week", () => {
  const range = getCalendarRange(new Date(2024, 8, 1));

  assert.equal(range.start, "2024-08-26");
  assert.equal(range.end, "2024-10-06");
  assert.deepEqual(range.days.slice(0, 7).map(({ dateKey }) => dateKey), [
    "2024-08-31",
    "2024-08-26",
    "2024-08-27",
    "2024-08-28",
    "2024-08-29",
    "2024-08-30",
    "2024-09-01",
  ]);
  assert.equal(range.days[6].isCurrentMonth, true);
  assertCustomWeekRows(new Date(2024, 8, 1));
});

test("a four-week month still uses complete custom Monday-through-Sunday rows", () => {
  const range = getCalendarRange(new Date(2021, 1, 1));

  assert.equal(range.weekCount, 4);
  assert.equal(range.start, "2021-02-01");
  assert.equal(range.end, "2021-02-28");
  assert.deepEqual(range.days.slice(0, 7).map(({ dateKey }) => dateKey), [
    "2021-02-06",
    "2021-02-01",
    "2021-02-02",
    "2021-02-03",
    "2021-02-04",
    "2021-02-05",
    "2021-02-07",
  ]);
  assertCustomWeekRows(new Date(2021, 1, 1));
});

test("December maps correctly across the year boundary", () => {
  const range = getCalendarRange(new Date(2025, 11, 1));

  assert.equal(range.start, "2025-12-01");
  assert.equal(range.end, "2026-01-04");
  assert.deepEqual(range.days.slice(-7).map(({ dateKey }) => dateKey), [
    "2026-01-03",
    "2025-12-29",
    "2025-12-30",
    "2025-12-31",
    "2026-01-01",
    "2026-01-02",
    "2026-01-04",
  ]);
  assert.deepEqual(range.days.slice(-7).map(({ isCurrentMonth }) => isCurrentMonth), [
    false,
    true,
    true,
    true,
    false,
    false,
    false,
  ]);
  assertCustomWeekRows(new Date(2025, 11, 1));
});

test("leap-year February includes February 29 beneath Thursday", () => {
  const range = getCalendarRange(new Date(2024, 1, 1));
  const leapDayIndex = range.days.findIndex(({ dateKey }) => dateKey === "2024-02-29");

  assert.equal(range.start, "2024-01-29");
  assert.equal(range.end, "2024-03-03");
  assert.notEqual(leapDayIndex, -1);
  assert.equal(leapDayIndex % 7, 4);
  assert.equal(range.days[leapDayIndex].date.getDay(), 4);
  assert.equal(range.days[leapDayIndex].isCurrentMonth, true);
  assertCustomWeekRows(new Date(2024, 1, 1));
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
    assertCustomWeekRows(month);
  });
});
