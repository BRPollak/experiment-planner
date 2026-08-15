import assert from "node:assert/strict";
import test from "node:test";

import {
  filterTasksByExperiment,
  formatTaskTime,
  groupTasksByExperiment,
  isValidTaskTime,
  sortTasks,
  type TaskGroupable,
} from "./tasks";

interface TestTask extends TaskGroupable {
  id: string;
}

function task(id: string, overrides: Omit<Partial<TestTask>, "id"> = {}): TestTask {
  return {
    id,
    experimentId: "experiment-a",
    ...overrides,
  };
}

test("sortTasks puts timed tasks first and orders them from earliest to latest", () => {
  const input = [
    task("untimed", { createdAt: "2026-01-01T08:00:00.000Z" }),
    task("afternoon", { time: "14:30", createdAt: "2026-01-01T07:00:00.000Z" }),
    task("morning", { time: "08:15", createdAt: "2026-01-01T09:00:00.000Z" }),
    task("midday", { time: "12:00", createdAt: "2026-01-01T06:00:00.000Z" }),
  ];

  assert.deepEqual(sortTasks(input).map(({ id }) => id), [
    "morning",
    "midday",
    "afternoon",
    "untimed",
  ]);
  assert.deepEqual(input.map(({ id }) => id), ["untimed", "afternoon", "morning", "midday"]);
});

test("sortTasks orders identical times by creation time from oldest to newest", () => {
  const input = [
    task("newest", { time: "09:15", createdAt: "2026-03-01T12:00:00.000Z" }),
    task("oldest", { time: "09:15", createdAt: "2026-03-01T08:00:00.000Z" }),
    task("middle", { time: "09:15", createdAt: "2026-03-01T10:00:00.000Z" }),
  ];

  assert.deepEqual(sortTasks(input).map(({ id }) => id), ["oldest", "middle", "newest"]);
});

test("sortTasks orders untimed tasks by creation time from oldest to newest", () => {
  const input = [
    task("newest", { time: null, createdAt: "2026-04-03T10:00:00.000Z" }),
    task("oldest", { createdAt: "2026-04-01T10:00:00.000Z" }),
    task("middle", { time: null, createdAt: "2026-04-02T10:00:00.000Z" }),
  ];

  assert.deepEqual(sortTasks(input).map(({ id }) => id), ["oldest", "middle", "newest"]);
});

test("sortTasks keeps legacy tasks without timestamps in stable persisted order", () => {
  const input = [
    task("legacy-second", { time: "10:00" }),
    task("legacy-first", { time: "10:00", createdAt: null }),
    task("invalid-legacy", { time: "10:00", createdAt: "not-a-timestamp" }),
    task("modern", { time: "10:00", createdAt: "2026-04-01T10:00:00.000Z" }),
  ];

  assert.deepEqual(sortTasks(input).map(({ id }) => id), [
    "legacy-second",
    "legacy-first",
    "invalid-legacy",
    "modern",
  ]);
});

test("sortTasks treats older records without a time as untimed", () => {
  const input = [
    task("legacy-untimed"),
    task("timed", { time: "23:45", createdAt: "2026-05-01T10:00:00.000Z" }),
  ];

  assert.deepEqual(sortTasks(input).map(({ id }) => id), ["timed", "legacy-untimed"]);
});

test("groupTasksByExperiment orders sections by first globally sorted task", () => {
  const experiments = [
    { id: "alpha", name: "Alpha" },
    { id: "beta", name: "Beta" },
  ];
  const input = [
    task("alpha-ten", { experimentId: "alpha", time: "10:00", createdAt: "2026-01-01T08:00:00.000Z" }),
    task("beta-eleven", { experimentId: "beta", time: "11:00", createdAt: "2026-01-01T08:00:00.000Z" }),
    task("unassociated-nine", { experimentId: "missing", time: "09:00", createdAt: "2026-01-01T08:00:00.000Z" }),
    task("beta-eight", { experimentId: "beta", time: "08:00", createdAt: "2026-01-01T08:00:00.000Z" }),
  ];

  const groups = groupTasksByExperiment(input, experiments);

  assert.deepEqual(groups.map(({ experimentId }) => experimentId), ["beta", null, "alpha"]);
  assert.equal(groups[0].experiment?.name, "Beta");
  assert.equal(groups[1].experiment, null);
  assert.deepEqual(groups[0].tasks.map(({ id }) => id), ["beta-eight", "beta-eleven"]);
  assert.deepEqual(groups[1].tasks.map(({ id }) => id), ["unassociated-nine"]);
  assert.deepEqual(groups[2].tasks.map(({ id }) => id), ["alpha-ten"]);
});

test("groupTasksByExperiment combines missing experiment metadata in one fallback section", () => {
  const groups = groupTasksByExperiment([
    task("no-id", { experimentId: null, time: "08:00" }),
    task("unknown-one", { experimentId: "removed-a", time: "09:00" }),
    task("unknown-two", { experimentId: "removed-b", time: "10:00" }),
  ], []);

  assert.equal(groups.length, 1);
  assert.equal(groups[0].experimentId, null);
  assert.equal(groups[0].experiment, null);
  assert.deepEqual(groups[0].tasks.map(({ id }) => id), ["no-id", "unknown-one", "unknown-two"]);
});

test("filterTasksByExperiment supplies the active experiment's tasks to calendar detail views", () => {
  const input = [
    task("alpha", { experimentId: "alpha" }),
    task("beta", { experimentId: "beta" }),
  ];

  assert.deepEqual(
    filterTasksByExperiment(input, "beta").map(({ id }) => id),
    ["beta"],
  );
  assert.deepEqual(
    filterTasksByExperiment(input, null).map(({ id }) => id),
    ["alpha", "beta"],
  );
});

test("task time validation accepts only quarter-hour HH:mm values", () => {
  for (const value of ["00:00", "08:15", "12:30", "23:45"]) {
    assert.equal(isValidTaskTime(value), true, value);
  }
  for (const value of [undefined, null, "", "8:15", "08:10", "24:00", "12:60", 815]) {
    assert.equal(isValidTaskTime(value), false, String(value));
  }
});

test("formatTaskTime localizes valid stored times and ignores untimed values", () => {
  assert.equal(formatTaskTime("09:15", "en-US"), "9:15 AM");
  assert.equal(formatTaskTime("21:30", "en-GB"), "21:30");
  assert.equal(formatTaskTime(null, "en-US"), null);
  assert.equal(formatTaskTime("09:10", "en-US"), null);
});
