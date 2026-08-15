import assert from "node:assert/strict";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import { ExperimentPlannerDatabase } from "../server/database";
import {
  importLegacyDatabaseIfRequested,
  legacyImportPathFromArguments,
} from "./legacy-import";

const temporaryDirectories: string[] = [];

function temporaryDirectory(): string {
  const directory = mkdtempSync(join(tmpdir(), "experiment-planner-electron-test-"));
  temporaryDirectories.push(directory);
  return directory;
}

function createV1Database(path: string): DatabaseSync {
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA foreign_keys = OFF;
    PRAGMA journal_mode = WAL;

    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE experiments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;

    CREATE TABLE tasks (
      id TEXT PRIMARY KEY,
      experiment_id TEXT NOT NULL,
      name TEXT NOT NULL,
      date TEXT NOT NULL,
      notes TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (experiment_id) REFERENCES experiments(id) ON DELETE CASCADE
    ) STRICT;

    CREATE INDEX tasks_by_date ON tasks(date);
    CREATE INDEX tasks_by_experiment_and_date ON tasks(experiment_id, date);

    INSERT INTO schema_migrations (version, applied_at)
    VALUES (1, '2026-08-14T00:00:00.000Z');
    PRAGMA user_version = 1;
  `);
  return database;
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

test("parses only one absolute legacy import path", () => {
  assert.equal(legacyImportPathFromArguments(["electron"]), null);
  assert.equal(
    legacyImportPathFromArguments(["electron", "--import-legacy-db=/tmp/planner.sqlite"]),
    "/tmp/planner.sqlite",
  );
  assert.throws(() => legacyImportPathFromArguments(["--import-legacy-db=relative.sqlite"]));
  assert.throws(() => legacyImportPathFromArguments([
    "--import-legacy-db=/tmp/one.sqlite",
    "--import-legacy-db=/tmp/two.sqlite",
  ]));
});

test("backs up the current supported database, including timed tasks", async () => {
  const directory = temporaryDirectory();
  const sourcePath = join(directory, "legacy.sqlite");
  const destinationPath = join(directory, "user-data", "experiment-planner.sqlite");
  const source = new ExperimentPlannerDatabase(sourcePath);
  const calendar = source.createCalendar({ name: "Imported calendar" });
  const experiment = source.createExperiment({
    name: "Imported",
    color: "#123456",
    calendarId: calendar.id,
  });
  const task = source.createTask({
    name: "Imported task",
    date: "2026-08-14",
    time: "10:30",
    experimentId: experiment.id,
  });

  // Keep the WAL-mode source open to exercise SQLite's online backup behavior.
  assert.equal(
    await importLegacyDatabaseIfRequested(destinationPath, [
      "electron",
      `--import-legacy-db=${sourcePath}`,
    ]),
    "imported",
  );
  source.close();

  const imported = new ExperimentPlannerDatabase(destinationPath);
  assert.equal(imported.getExperiment(experiment.id)?.name, "Imported");
  assert.equal(imported.getTask(task.id)?.name, "Imported task");
  assert.equal(imported.getTask(task.id)?.time, "10:30");
  imported.close();
});

test("accepts a supported v1 database for normal application migration", async () => {
  const directory = temporaryDirectory();
  const sourcePath = join(directory, "legacy-v1.sqlite");
  const destinationPath = join(directory, "user-data", "experiment-planner.sqlite");
  const source = createV1Database(sourcePath);
  source.exec(`
    INSERT INTO experiments (
      id, name, color, description, created_at, updated_at
    ) VALUES (
      'legacy-experiment', 'Legacy experiment', '#123456', NULL,
      '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z'
    );
    INSERT INTO tasks (
      id, experiment_id, name, date, notes, created_at, updated_at
    ) VALUES (
      'legacy-task', 'legacy-experiment', 'Legacy task', '2026-08-14', NULL,
      '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z'
    );
  `);

  assert.equal(
    await importLegacyDatabaseIfRequested(destinationPath, [
      "electron",
      `--import-legacy-db=${sourcePath}`,
    ]),
    "imported",
  );
  source.close();

  const imported = new ExperimentPlannerDatabase(destinationPath);
  assert.equal(imported.getExperiment("legacy-experiment")?.calendarId, null);
  assert.equal(imported.getTask("legacy-task")?.name, "Legacy task");
  assert.equal(imported.getTask("legacy-task")?.time, null);
  assert.equal(imported.getMigrationStatus().required, true);
  imported.close();
});

test("rejects a healthy SQLite file with an incompatible schema", async () => {
  const directory = temporaryDirectory();
  const sourcePath = join(directory, "unrelated.sqlite");
  const destinationPath = join(directory, "user-data", "experiment-planner.sqlite");
  const source = new DatabaseSync(sourcePath);
  source.exec(`
    CREATE TABLE unrelated (id INTEGER PRIMARY KEY, value TEXT) STRICT;
    INSERT INTO unrelated (value) VALUES ('healthy but not a planner database');
    PRAGMA user_version = 1;
  `);
  source.close();

  await assert.rejects(
    importLegacyDatabaseIfRequested(destinationPath, [
      "electron",
      `--import-legacy-db=${sourcePath}`,
    ]),
    /supported .* column|supported Experiment Planner database/i,
  );
  assert.equal(existsSync(destinationPath), false);
});

test("rejects foreign-key violations without creating the destination", async () => {
  const directory = temporaryDirectory();
  const sourcePath = join(directory, "broken-relationships.sqlite");
  const destinationPath = join(directory, "user-data", "experiment-planner.sqlite");
  const source = createV1Database(sourcePath);
  source.exec(`
    INSERT INTO tasks (
      id, experiment_id, name, date, notes, created_at, updated_at
    ) VALUES (
      'orphan-task', 'missing-experiment', 'Orphan task', '2026-08-14', NULL,
      '2026-08-14T00:00:00.000Z', '2026-08-14T00:00:00.000Z'
    );
  `);
  source.close();

  await assert.rejects(
    importLegacyDatabaseIfRequested(destinationPath, [
      "electron",
      `--import-legacy-db=${sourcePath}`,
    ]),
    /invalid relationships/i,
  );
  assert.equal(existsSync(destinationPath), false);
});

test("rejects a database newer than the supported schema version", async () => {
  const directory = temporaryDirectory();
  const sourcePath = join(directory, "future.sqlite");
  const destinationPath = join(directory, "user-data", "experiment-planner.sqlite");
  const source = new ExperimentPlannerDatabase(sourcePath);
  source.close();
  const future = new DatabaseSync(sourcePath);
  future.exec("PRAGMA user_version = 4");
  future.close();

  await assert.rejects(
    importLegacyDatabaseIfRequested(destinationPath, [
      "electron",
      `--import-legacy-db=${sourcePath}`,
    ]),
    /newer than the supported version 3/i,
  );
  assert.equal(existsSync(destinationPath), false);
});

test("never replaces an existing desktop database", async () => {
  const directory = temporaryDirectory();
  const sourcePath = join(directory, "legacy.sqlite");
  const destinationPath = join(directory, "experiment-planner.sqlite");

  const source = new ExperimentPlannerDatabase(sourcePath);
  const sourceCalendar = source.createCalendar({ name: "Legacy calendar" });
  source.createExperiment({
    name: "Legacy",
    color: "#123456",
    calendarId: sourceCalendar.id,
  });
  source.close();

  const destination = new ExperimentPlannerDatabase(destinationPath);
  const destinationCalendar = destination.createCalendar({ name: "Desktop calendar" });
  const retained = destination.createExperiment({
    name: "Keep me",
    color: "#654321",
    calendarId: destinationCalendar.id,
  });
  destination.close();

  assert.equal(
    await importLegacyDatabaseIfRequested(destinationPath, [
      "electron",
      `--import-legacy-db=${sourcePath}`,
    ]),
    "skipped-existing",
  );

  const reopened = new ExperimentPlannerDatabase(destinationPath);
  assert.equal(reopened.getExperiment(retained.id)?.name, "Keep me");
  assert.equal(reopened.listExperiments().length, 1);
  reopened.close();
});
