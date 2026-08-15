import assert from "node:assert/strict";
import test from "node:test";

import {
  getCalendarRange,
  toDateKey,
  WEEKDAY_ORDER,
  WEEKDAYS,
  type CalendarDay,
} from "./dates";

const WEEKDAY_OFFSETS = [-2, 0, 1, 2, 3, 4, 6] as const;

function addLocalDays(date: Date, count: number): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + count);
}

function rows(days: CalendarDay[]): CalendarDay[][] {
  return Array.from({ length: days.length / 7 }, (_, index) => (
    days.slice(index * 7, index * 7 + 7)
  ));
}

function assertWeekendBookendRows(month: Date): void {
  const range = getCalendarRange(month);
  assert.equal(range.days.length, range.weekCount * 7);
  assert.equal(new Set(range.days.map(({ dateKey }) => dateKey)).size, range.days.length);

  rows(range.days).forEach((week) => {
    assert.deepEqual(week.map(({ date }) => date.getDay()), [...WEEKDAY_ORDER]);
    const monday = week[1].date;
    assert.deepEqual(
      week.map(({ dateKey }) => dateKey),
      WEEKDAY_OFFSETS.map((offset) => toDateKey(addLocalDays(monday, offset))),
    );
    week.slice(1).forEach((day, index) => {
      assert.ok(day.date.getTime() > week[index].date.getTime());
    });
  });

  const expectedCurrentMonth = Array.from(
    { length: new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate() },
    (_, index) => toDateKey(new Date(month.getFullYear(), month.getMonth(), index + 1)),
  );
  const actualCurrentMonth = range.days
    .filter(({ isCurrentMonth }) => isCurrentMonth)
    .map(({ dateKey }) => dateKey)
    .sort();
  assert.deepEqual(actualCurrentMonth, expectedCurrentMonth);

  const chronologicalKeys = range.days.map(({ dateKey }) => dateKey).sort();
  assert.equal(range.start, chronologicalKeys[0]);
  assert.equal(range.end, chronologicalKeys[chronologicalKeys.length - 1]);
}

test("weekday headings use Saturday and Sunday as visual bookends", () => {
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

test("August 2026 keeps the leading Saturday earlier than the weekdays that follow it", () => {
  const range = getCalendarRange(new Date(2026, 7, 1));

  assert.equal(range.start, "2026-07-25");
  assert.equal(range.end, "2026-09-06");
  assert.equal(range.weekCount, 6);
  assert.deepEqual(range.days.slice(0, 7).map(({ dateKey }) => dateKey), [
    "2026-07-25",
    "2026-07-27",
    "2026-07-28",
    "2026-07-29",
    "2026-07-30",
    "2026-07-31",
    "2026-08-02",
  ]);
  assert.deepEqual(range.days.slice(14, 21).map(({ dateKey }) => dateKey), [
    "2026-08-08",
    "2026-08-10",
    "2026-08-11",
    "2026-08-12",
    "2026-08-13",
    "2026-08-14",
    "2026-08-16",
  ]);
  assert.deepEqual(range.days.slice(21, 28).map(({ dateKey }) => dateKey), [
    "2026-08-15",
    "2026-08-17",
    "2026-08-18",
    "2026-08-19",
    "2026-08-20",
    "2026-08-21",
    "2026-08-23",
  ]);
  assert.deepEqual(range.days.slice(-7).map(({ dateKey }) => dateKey), [
    "2026-08-29",
    "2026-08-31",
    "2026-09-01",
    "2026-09-02",
    "2026-09-03",
    "2026-09-04",
    "2026-09-06",
  ]);
  assertWeekendBookendRows(new Date(2026, 7, 1));
});

test("a month beginning Sunday keeps that Sunday at the preceding row's right edge", () => {
  const range = getCalendarRange(new Date(2024, 8, 1));

  assert.equal(range.start, "2024-08-24");
  assert.equal(range.end, "2024-10-06");
  assert.deepEqual(range.days.slice(0, 7).map(({ dateKey }) => dateKey), [
    "2024-08-24",
    "2024-08-26",
    "2024-08-27",
    "2024-08-28",
    "2024-08-29",
    "2024-08-30",
    "2024-09-01",
  ]);
  assert.equal(range.days[6].isCurrentMonth, true);
  assertWeekendBookendRows(new Date(2024, 8, 1));
});

test("a nominal four-week month adds the row needed for its final Saturday", () => {
  const range = getCalendarRange(new Date(2021, 1, 1));

  assert.equal(range.weekCount, 5);
  assert.equal(range.start, "2021-01-30");
  assert.equal(range.end, "2021-03-07");
  assert.deepEqual(range.days.slice(0, 7).map(({ dateKey }) => dateKey), [
    "2021-01-30",
    "2021-02-01",
    "2021-02-02",
    "2021-02-03",
    "2021-02-04",
    "2021-02-05",
    "2021-02-07",
  ]);
  assert.deepEqual(range.days.slice(-7).map(({ dateKey }) => dateKey), [
    "2021-02-27",
    "2021-03-01",
    "2021-03-02",
    "2021-03-03",
    "2021-03-04",
    "2021-03-05",
    "2021-03-07",
  ]);
  assertWeekendBookendRows(new Date(2021, 1, 1));
});

test("December maps correctly across the year boundary", () => {
  const range = getCalendarRange(new Date(2025, 11, 1));

  assert.equal(range.start, "2025-11-29");
  assert.equal(range.end, "2026-01-04");
  assert.deepEqual(range.days.slice(-7).map(({ dateKey }) => dateKey), [
    "2025-12-27",
    "2025-12-29",
    "2025-12-30",
    "2025-12-31",
    "2026-01-01",
    "2026-01-02",
    "2026-01-04",
  ]);
  assert.deepEqual(range.days.slice(-7).map(({ isCurrentMonth }) => isCurrentMonth), [
    true,
    true,
    true,
    true,
    false,
    false,
    false,
  ]);
  assertWeekendBookendRows(new Date(2025, 11, 1));
});

test("leap-year February includes February 29 beneath Thursday", () => {
  const range = getCalendarRange(new Date(2024, 1, 1));
  const leapDayIndex = range.days.findIndex(({ dateKey }) => dateKey === "2024-02-29");

  assert.equal(range.start, "2024-01-27");
  assert.equal(range.end, "2024-03-03");
  assert.notEqual(leapDayIndex, -1);
  assert.equal(leapDayIndex % 7, 4);
  assert.equal(range.days[leapDayIndex].date.getDay(), 4);
  assert.equal(range.days[leapDayIndex].isCurrentMonth, true);
  assertWeekendBookendRows(new Date(2024, 1, 1));
});

test("every month from 2000 through 2100 keeps all dates unique and in the correct columns", () => {
  for (let year = 2000; year <= 2100; year += 1) {
    for (let month = 0; month < 12; month += 1) {
      assertWeekendBookendRows(new Date(year, month, 1));
    }
  }
});
