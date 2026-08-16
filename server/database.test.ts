import assert from "node:assert/strict";
import {
  copyFileSync,
  mkdtempSync,
  readdirSync,
  rmSync,
  statSync,
  utimesSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { afterEach, test } from "node:test";

import {
  ExperimentPlannerDatabase,
  InvalidDatabaseMigrationStateError,
  latestSupportedSchemaVersion,
  MigrationBackupError,
  migrationBackupRetention,
  RelatedEntityNotFoundError,
  UnsupportedDatabaseVersionError,
} from "./database";

const temporaryDirectories: string[] = [];
const openDatabases: ExperimentPlannerDatabase[] = [];

function temporaryPath(): string {
  const directory = mkdtempSync(join(tmpdir(), "experiment-planner-test-"));
  temporaryDirectories.push(directory);
  return join(directory, "planner.sqlite");
}

function openDatabase(path = temporaryPath()): ExperimentPlannerDatabase {
  const database = new ExperimentPlannerDatabase(path);
  openDatabases.push(database);
  return database;
}

async function openDatabaseWithBackup(
  path = temporaryPath(),
): Promise<ExperimentPlannerDatabase> {
  const database = await ExperimentPlannerDatabase.open(path);
  openDatabases.push(database);
  return database;
}

function migrationBackupPaths(databasePath: string): string[] {
  const prefix = `${basename(databasePath)}.pre-migration-v`;
  return readdirSync(dirname(databasePath))
    .filter((name) => name.startsWith(prefix) && name.endsWith(".sqlite"))
    .map((name) => join(dirname(databasePath), name))
    .sort();
}

function createPopulatedV2Database(path: string): DatabaseSync {
  const database = new DatabaseSync(path);
  database.exec(`
    PRAGMA foreign_keys = OFF;

    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE calendars (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE experiments (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL,
      color TEXT NOT NULL,
      description TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      calendar_id TEXT REFERENCES calendars(id) ON DELETE CASCADE
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
    CREATE INDEX experiments_by_calendar ON experiments(calendar_id);
    INSERT INTO schema_migrations (version, applied_at) VALUES
      (1, '2026-01-01T00:00:00.000Z'),
      (2, '2026-02-01T00:00:00.000Z');
    PRAGMA user_version = 2;
    PRAGMA journal_mode = WAL;
    PRAGMA wal_autocheckpoint = 0;

    INSERT INTO calendars (id, name, created_at, updated_at) VALUES (
      'v2-calendar', 'V2 calendar',
      '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'
    );
    INSERT INTO experiments (
      id, name, color, description, calendar_id, created_at, updated_at
    ) VALUES (
      'v2-experiment', 'V2 experiment', '#123456', 'Preserve the experiment',
      'v2-calendar', '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'
    );
    INSERT INTO tasks (
      id, experiment_id, name, date, notes, created_at, updated_at
    ) VALUES (
      'v2-task', 'v2-experiment', 'V2 task', '2026-08-14', 'Preserve the task',
      '2026-02-01T00:00:00.000Z', '2026-02-01T00:00:00.000Z'
    );
  `);
  return database;
}

afterEach(() => {
  while (openDatabases.length > 0) openDatabases.pop()!.close();
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop()!, { recursive: true, force: true });
  }
});

test("initializes an empty v5 database and persists calendars after reopening", () => {
  const path = temporaryPath();
  const database = openDatabase(path);
  assert.equal(latestSupportedSchemaVersion, 5);
  assert.deepEqual(database.listCalendars(), []);
  assert.deepEqual(database.getMigrationStatus(), {
    required: false,
    unassignedExperimentCount: 0,
    unassignedTaskCount: 0,
  });

  const created = database.createCalendar({ name: "Primary calendar" });
  assert.equal(created.archived, false);
  assert.equal(created.experimentCount, 0);
  assert.equal(created.taskCount, 0);
  database.close();

  const reopened = openDatabase(path);
  assert.deepEqual(reopened.getCalendar(created.id), created);
});

test("does not create migration backups for fresh or current databases", async () => {
  const path = temporaryPath();
  const fresh = await openDatabaseWithBackup(path);
  fresh.createCalendar({ name: "Already current" });
  assert.deepEqual(migrationBackupPaths(path), []);
  fresh.close();

  const markerless = new DatabaseSync(path);
  markerless.exec("DELETE FROM schema_migrations");
  markerless.close();

  const reopened = await openDatabaseWithBackup(path);
  assert.equal(reopened.listCalendars().length, 1);
  assert.deepEqual(migrationBackupPaths(path), []);
  const recoveredMarkers = new DatabaseSync(path, { readOnly: true });
  assert.deepEqual(
    recoveredMarkers
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => Number(row.version)),
    [1, 2, 3, 4, 5],
  );
  recoveredMarkers.close();
});

test("backs up WAL-backed v2 data before migration and produces a restorable snapshot", async () => {
  const path = temporaryPath();
  const v2 = createPopulatedV2Database(path);
  assert.ok(statSync(`${path}-wal`).size > 0);

  let migrated: ExperimentPlannerDatabase;
  try {
    migrated = await openDatabaseWithBackup(path);
  } finally {
    v2.close();
  }

  assert.equal(migrated.getCalendar("v2-calendar")?.name, "V2 calendar");
  assert.equal(migrated.getCalendar("v2-calendar")?.archived, false);
  assert.equal(migrated.getExperiment("v2-experiment")?.description, "Preserve the experiment");
  assert.equal(migrated.getExperiment("v2-experiment")?.archived, false);
  assert.equal(migrated.getTask("v2-task")?.notes, "Preserve the task");
  assert.equal(migrated.getTask("v2-task")?.time, null);
  assert.equal(migrated.getTask("v2-task")?.completed, false);

  const backupPaths = migrationBackupPaths(path);
  assert.equal(backupPaths.length, 1);
  assert.match(backupPaths[0], /\.pre-migration-v2-to-v5-/);
  assert.equal(statSync(backupPaths[0]).mode & 0o777, 0o600);

  const snapshot = new DatabaseSync(backupPaths[0], { readOnly: true });
  const quickCheck = snapshot.prepare("PRAGMA quick_check").get() as
    | Record<string, unknown>
    | undefined;
  assert.equal(String(Object.values(quickCheck ?? {})[0]), "ok");
  assert.deepEqual(snapshot.prepare("PRAGMA foreign_key_check").all(), []);
  assert.equal(
    (snapshot.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
    2,
  );
  assert.equal(
    snapshot.prepare("SELECT name FROM tasks WHERE id = ?").get("v2-task")?.name,
    "V2 task",
  );
  assert.equal(
    snapshot
      .prepare("PRAGMA table_info(tasks)")
      .all()
      .some((column) => column.name === "time"),
    false,
  );
  assert.equal(
    snapshot
      .prepare("PRAGMA table_info(calendars)")
      .all()
      .some((column) => column.name === "archived"),
    false,
  );
  assert.equal(
    snapshot
      .prepare("PRAGMA table_info(experiments)")
      .all()
      .some((column) => column.name === "archived"),
    false,
  );
  assert.equal(
    snapshot
      .prepare("PRAGMA table_info(tasks)")
      .all()
      .some((column) => column.name === "completed"),
    false,
  );
  snapshot.close();

  const restoredPath = join(dirname(path), "restored.sqlite");
  copyFileSync(backupPaths[0], restoredPath);
  const restored = await openDatabaseWithBackup(restoredPath);
  assert.equal(restored.getCalendar("v2-calendar")?.archived, false);
  assert.equal(restored.getExperiment("v2-experiment")?.archived, false);
  assert.equal(restored.getTask("v2-task")?.name, "V2 task");
  assert.equal(restored.getTask("v2-task")?.time, null);
  assert.equal(restored.getTask("v2-task")?.completed, false);
});

test("refuses an invalid backup without migrating or changing the source", async () => {
  const path = temporaryPath();
  const v2 = createPopulatedV2Database(path);
  v2.prepare(`
    INSERT INTO tasks (
      id, experiment_id, name, date, notes, created_at, updated_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?)
  `).run(
    "orphan-task",
    "missing-experiment",
    "Must not be hidden by migration",
    "2026-08-15",
    null,
    "2026-02-01T00:00:00.000Z",
    "2026-02-01T00:00:00.000Z",
  );

  try {
    await assert.rejects(
      ExperimentPlannerDatabase.open(path),
      (error) => (
        error instanceof MigrationBackupError
        && /invalid relationships/i.test(error.message)
      ),
    );
  } finally {
    v2.close();
  }

  const unchanged = new DatabaseSync(path, { readOnly: true });
  assert.equal(
    (unchanged.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
    2,
  );
  assert.equal(
    unchanged
      .prepare("PRAGMA table_info(tasks)")
      .all()
      .some((column) => column.name === "time"),
    false,
  );
  assert.equal(
    unchanged
      .prepare("PRAGMA table_info(tasks)")
      .all()
      .some((column) => column.name === "completed"),
    false,
  );
  assert.equal(
    (unchanged.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number }).count,
    2,
  );
  unchanged.close();
  assert.deepEqual(migrationBackupPaths(path), []);
  assert.equal(
    readdirSync(dirname(path)).some((name) => (
      name.includes(".incomplete")
      || name.startsWith(".experiment-planner-backup-")
    )),
    false,
  );
});

test("retains only the newest small history of migration backups", async () => {
  const path = temporaryPath();
  const v2 = createPopulatedV2Database(path);
  const now = Date.now();
  for (let index = 0; index < migrationBackupRetention + 2; index += 1) {
    const oldPath = `${path}.pre-migration-v1-to-v2-2025-01-01T00-00-00-000Z-`
      + `00000000-0000-4000-8000-${String(index).padStart(12, "0")}.sqlite`;
    writeFileSync(oldPath, `old backup ${index}`);
    const modifiedAt = new Date(now - ((index + 1) * 60_000));
    utimesSync(oldPath, modifiedAt, modifiedAt);
  }

  try {
    await openDatabaseWithBackup(path);
  } finally {
    v2.close();
  }

  const retained = migrationBackupPaths(path);
  assert.equal(retained.length, migrationBackupRetention);
  assert.equal(retained.some((candidate) => candidate.includes("v2-to-v5")), true);
});

test("keeps older recovery points when preflight rejects an inconsistent schema", async () => {
  const path = temporaryPath();
  const partiallyMigrated = createPopulatedV2Database(path);
  partiallyMigrated.exec("ALTER TABLE tasks ADD COLUMN time TEXT");
  partiallyMigrated.close();

  const previousBackups: string[] = [];
  for (let index = 0; index < migrationBackupRetention; index += 1) {
    const previousPath = `${path}.pre-migration-v1-to-v2-2025-01-01T00-00-00-000Z-`
      + `10000000-0000-4000-8000-${String(index).padStart(12, "0")}.sqlite`;
    writeFileSync(previousPath, `older recovery point ${index}`);
    previousBackups.push(previousPath);
  }

  await assert.rejects(
    ExperimentPlannerDatabase.open(path),
    (error) => (
      error instanceof InvalidDatabaseMigrationStateError
      && /mismatched tables: tasks/.test(error.message)
    ),
  );

  const backupsAfterFailure = migrationBackupPaths(path);
  assert.equal(backupsAfterFailure.length, migrationBackupRetention);
  for (const previousPath of previousBackups) {
    assert.equal(backupsAfterFailure.includes(previousPath), true);
  }

  const unchanged = new DatabaseSync(path, { readOnly: true });
  assert.equal(
    (unchanged.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
    2,
  );
  assert.deepEqual(
    unchanged
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => Number(row.version)),
    [1, 2],
  );
  unchanged.close();
});

test("rejects gapped migration markers without changing the database", async () => {
  const path = temporaryPath();
  const inconsistent = new DatabaseSync(path);
  inconsistent.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
    CREATE TABLE sentinel (value TEXT NOT NULL) STRICT;
    INSERT INTO sentinel (value) VALUES ('unchanged');
    INSERT INTO schema_migrations (version, applied_at) VALUES
      (1, '2026-01-01T00:00:00.000Z'),
      (3, '2026-03-01T00:00:00.000Z');
    PRAGMA user_version = 3;
  `);
  inconsistent.close();

  await assert.rejects(
    ExperimentPlannerDatabase.open(path),
    (error) => (
      error instanceof InvalidDatabaseMigrationStateError
      && error.userVersion === 3
      && error.recordedVersions.join(",") === "1,3"
    ),
  );

  const unchanged = new DatabaseSync(path, { readOnly: true });
  assert.equal(
    (unchanged.prepare("SELECT value FROM sentinel").get() as { value: string }).value,
    "unchanged",
  );
  assert.deepEqual(
    unchanged
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => Number(row.version)),
    [1, 3],
  );
  unchanged.close();
  assert.deepEqual(migrationBackupPaths(path), []);
});

test("rejects marker and user_version disagreement before replaying a migration", async () => {
  const path = temporaryPath();
  const v2 = createPopulatedV2Database(path);
  v2.prepare(
    "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
  ).run(3, "2026-03-01T00:00:00.000Z");
  v2.close();

  await assert.rejects(
    ExperimentPlannerDatabase.open(path),
    (error) => (
      error instanceof InvalidDatabaseMigrationStateError
      && error.userVersion === 2
      && error.recordedVersions.join(",") === "1,2,3"
    ),
  );

  const unchanged = new DatabaseSync(path, { readOnly: true });
  assert.equal(
    (unchanged.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
    2,
  );
  assert.equal(
    unchanged
      .prepare("PRAGMA table_info(tasks)")
      .all()
      .some((column) => column.name === "time"),
    false,
  );
  assert.equal(
    (unchanged.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number }).count,
    1,
  );
  unchanged.close();
  assert.deepEqual(migrationBackupPaths(path), []);
});

test("rejects a partially advanced schema before creating a migration backup", async () => {
  const path = temporaryPath();
  const v2 = createPopulatedV2Database(path);
  v2.exec("ALTER TABLE tasks ADD COLUMN time TEXT");
  v2.close();

  await assert.rejects(
    ExperimentPlannerDatabase.open(path),
    (error) => (
      error instanceof InvalidDatabaseMigrationStateError
      && error.userVersion === 2
      && /mismatched tables: tasks/.test(error.message)
    ),
  );

  const unchanged = new DatabaseSync(path, { readOnly: true });
  assert.equal(
    (unchanged.prepare("PRAGMA user_version").get() as { user_version: number }).user_version,
    2,
  );
  assert.equal(
    unchanged
      .prepare("PRAGMA table_info(tasks)")
      .all()
      .some((column) => column.name === "time"),
    true,
  );
  unchanged.close();
  assert.deepEqual(migrationBackupPaths(path), []);
});

test("rejects missing or empty ledgers when the schema does not match user_version", async () => {
  for (const ledger of ["empty", "missing"] as const) {
    const path = temporaryPath();
    const v2 = createPopulatedV2Database(path);
    v2.exec(ledger === "empty"
      ? "DELETE FROM schema_migrations"
      : "DROP TABLE schema_migrations");
    v2.exec("PRAGMA user_version = 3");
    v2.close();

    await assert.rejects(
      ExperimentPlannerDatabase.open(path),
      (error) => (
        error instanceof InvalidDatabaseMigrationStateError
        && error.userVersion === 3
        && error.recordedVersions.length === 0
        && /schema does not match/i.test(error.message)
      ),
    );

    const unchanged = new DatabaseSync(path, { readOnly: true });
    assert.equal(
      unchanged
        .prepare("PRAGMA table_info(tasks)")
        .all()
        .some((column) => column.name === "time"),
      false,
    );
    assert.equal(
      (unchanged.prepare("SELECT COUNT(*) AS count FROM tasks").get() as { count: number }).count,
      1,
    );
    if (ledger === "empty") {
      assert.equal(
        (unchanged.prepare("SELECT COUNT(*) AS count FROM schema_migrations").get() as { count: number }).count,
        0,
      );
    }
    unchanged.close();
    assert.deepEqual(migrationBackupPaths(path), []);
  }
});

test("recovers an empty migration ledger from user_version before migrating", async () => {
  const path = temporaryPath();
  const v2 = createPopulatedV2Database(path);
  v2.exec("DELETE FROM schema_migrations");

  let migrated: ExperimentPlannerDatabase;
  try {
    migrated = await openDatabaseWithBackup(path);
  } finally {
    v2.close();
  }

  assert.equal(migrated.getTask("v2-task")?.name, "V2 task");
  assert.equal(migrated.getTask("v2-task")?.time, null);
  const verification = new DatabaseSync(path, { readOnly: true });
  assert.deepEqual(
    verification
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all()
      .map((row) => Number(row.version)),
    [1, 2, 3, 4, 5],
  );
  verification.close();
  assert.equal(migrationBackupPaths(path).length, 1);
});

test("rejects a future PRAGMA user_version before creating migration bookkeeping", () => {
  const path = temporaryPath();
  const futureVersion = latestSupportedSchemaVersion + 1;
  const future = new DatabaseSync(path);
  future.exec(`
    CREATE TABLE sentinel (value TEXT NOT NULL) STRICT;
    INSERT INTO sentinel (value) VALUES ('untouched');
    PRAGMA user_version = ${futureVersion};
  `);
  future.close();

  assert.throws(
    () => new ExperimentPlannerDatabase(path),
    (error) =>
      error instanceof UnsupportedDatabaseVersionError &&
      error.source === "user_version" &&
      error.foundVersion === futureVersion &&
      error.latestSupportedVersion === latestSupportedSchemaVersion,
  );

  const verification = new DatabaseSync(path, { readOnly: true });
  assert.equal(
    verification
      .prepare(
        "SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = 'schema_migrations'",
      )
      .get(),
    undefined,
  );
  const sentinel = verification.prepare("SELECT value FROM sentinel").get() as
    | { value: string }
    | undefined;
  assert.equal(sentinel?.value, "untouched");
  verification.close();
});

test("rejects a future schema_migrations version before running migrations", () => {
  const path = temporaryPath();
  const futureVersion = latestSupportedSchemaVersion + 1;
  const future = new DatabaseSync(path);
  future.exec(`
    CREATE TABLE schema_migrations (
      version INTEGER PRIMARY KEY,
      applied_at TEXT NOT NULL
    ) STRICT;
    INSERT INTO schema_migrations (version, applied_at)
      VALUES (${futureVersion}, '2026-08-14T00:00:00.000Z');
    PRAGMA user_version = ${latestSupportedSchemaVersion};
  `);
  future.close();

  assert.throws(
    () => new ExperimentPlannerDatabase(path),
    (error) =>
      error instanceof UnsupportedDatabaseVersionError &&
      error.source === "schema_migrations" &&
      error.foundVersion === futureVersion,
  );

  const verification = new DatabaseSync(path, { readOnly: true });
  const migration = verification
    .prepare("SELECT version, applied_at FROM schema_migrations")
    .get() as { version: number; applied_at: string } | undefined;
  assert.equal(migration?.version, futureVersion);
  assert.equal(migration?.applied_at, "2026-08-14T00:00:00.000Z");
  verification.close();
});

test("migrates a populated v1 database without assigning or losing legacy data", () => {
  const path = temporaryPath();
  const legacy = new DatabaseSync(path);
  legacy.exec(`
    PRAGMA foreign_keys = ON;
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
      VALUES (1, '2026-01-01T00:00:00.000Z');
    PRAGMA user_version = 1;
    INSERT INTO experiments (
      id, name, color, description, created_at, updated_at
    ) VALUES (
      'legacy-experiment', 'Legacy experiment', '#123456', 'Preserve me',
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
    INSERT INTO tasks (
      id, experiment_id, name, date, notes, created_at, updated_at
    ) VALUES (
      'legacy-task', 'legacy-experiment', 'Legacy task', '2026-08-14', 'Also preserve me',
      '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z'
    );
  `);
  legacy.close();

  const database = openDatabase(path);
  assert.deepEqual(database.getMigrationStatus(), {
    required: true,
    unassignedExperimentCount: 1,
    unassignedTaskCount: 1,
  });
  assert.equal(database.getExperiment("legacy-experiment")?.calendarId, null);
  assert.equal(database.getExperiment("legacy-experiment")?.archived, false);
  assert.equal(database.getTask("legacy-task")?.notes, "Also preserve me");
  assert.equal(database.getTask("legacy-task")?.time, null);
  assert.equal(database.getTask("legacy-task")?.completed, false);
  assert.equal(
    database.getTask("legacy-task")?.createdAt,
    "2026-01-01T00:00:00.000Z",
  );

  assert.throws(
    () => database.migrateUnassignedExperiments("missing-calendar"),
    (error) =>
      error instanceof RelatedEntityNotFoundError && error.entity === "calendar",
  );
  assert.equal(database.getExperiment("legacy-experiment")?.calendarId, null);

  const target = database.createCalendar({ name: "Imported work" });
  assert.equal(target.archived, false);
  assert.deepEqual(database.migrateUnassignedExperiments(target.id), {
    required: false,
    unassignedExperimentCount: 0,
    unassignedTaskCount: 0,
  });
  assert.equal(database.getExperiment("legacy-experiment")?.calendarId, target.id);
  assert.deepEqual(
    database.listTasks({ calendarId: target.id }).map((task) => task.id),
    ["legacy-task"],
  );

  database.close();
  const reopened = openDatabase(path);
  assert.equal(reopened.getExperiment("legacy-experiment")?.calendarId, target.id);
  assert.equal(reopened.getExperiment("legacy-experiment")?.archived, false);
  assert.equal(reopened.getTask("legacy-task")?.name, "Legacy task");
  assert.equal(reopened.getTask("legacy-task")?.time, null);
  assert.equal(reopened.getTask("legacy-task")?.completed, false);
  assert.equal(
    reopened.getTask("legacy-task")?.createdAt,
    "2026-01-01T00:00:00.000Z",
  );
  assert.equal(reopened.getCalendar(target.id)?.experimentCount, 1);
  assert.equal(reopened.getCalendar(target.id)?.archived, false);
  assert.equal(reopened.getCalendar(target.id)?.taskCount, 1);
});

test("persists independent calendar and experiment archive state", () => {
  const path = temporaryPath();
  const database = openDatabase(path);
  const calendar = database.createCalendar({ name: "Archive independently" });
  const experiment = database.createExperiment({
    name: "Independent child",
    color: "#123456",
    calendarId: calendar.id,
  });

  assert.equal(calendar.archived, false);
  assert.equal(experiment.archived, false);

  assert.equal(
    database.updateCalendar(calendar.id, { archived: true })?.archived,
    true,
  );
  assert.equal(
    database.updateCalendar(calendar.id, { name: "Renamed while archived" })?.archived,
    true,
    "ordinary edits must preserve archive state",
  );
  assert.equal(
    database.getExperiment(experiment.id)?.archived,
    false,
    "archiving a calendar must not overwrite its experiments' independent state",
  );

  assert.equal(
    database.updateExperiment(experiment.id, { archived: true })?.archived,
    true,
  );
  assert.equal(
    database.updateExperiment(experiment.id, { description: "Still archived" })?.archived,
    true,
    "ordinary experiment edits must preserve archive state",
  );
  assert.equal(
    database.updateCalendar(calendar.id, { archived: false })?.archived,
    false,
  );
  assert.equal(
    database.getExperiment(experiment.id)?.archived,
    true,
    "unarchiving a calendar must not implicitly unarchive its experiments",
  );

  database.close();
  const reopened = openDatabase(path);
  assert.equal(reopened.getCalendar(calendar.id)?.archived, false);
  assert.equal(reopened.getExperiment(experiment.id)?.archived, true);
});

test("persists task completion and optional quarter-hour times", () => {
  const path = temporaryPath();
  const database = openDatabase(path);
  const calendar = database.createCalendar({ name: "Task times" });
  const experiment = database.createExperiment({
    name: "Timed work",
    color: "#123456",
    calendarId: calendar.id,
  });

  const untimed = database.createTask({
    name: "Untimed task",
    date: "2026-08-14",
    experimentId: experiment.id,
  });
  const timed = database.createTask({
    name: "Timed task",
    date: "2026-08-14",
    time: "09:15",
    experimentId: experiment.id,
    completed: true,
  });

  assert.equal(untimed.time, null);
  assert.equal(untimed.completed, false);
  assert.equal(timed.time, "09:15");
  assert.equal(timed.completed, true);
  assert.equal(database.updateTask(timed.id, { name: "Renamed" })?.time, "09:15");
  assert.equal(database.getTask(timed.id)?.completed, true);
  assert.equal(database.updateTask(untimed.id, { completed: true })?.completed, true);
  assert.equal(database.updateTask(timed.id, { completed: false })?.completed, false);
  assert.equal(database.updateTask(timed.id, { time: null })?.time, null);
  assert.throws(() => database.updateTask(untimed.id, { time: "09:10" }));

  database.close();
  const reopened = openDatabase(path);
  assert.equal(reopened.getTask(untimed.id)?.time, null);
  assert.equal(reopened.getTask(untimed.id)?.completed, true);
  assert.equal(reopened.getTask(timed.id)?.time, null);
  assert.equal(reopened.getTask(timed.id)?.completed, false);
});

test("scopes experiments and tasks by calendar and updates aggregate counts", () => {
  const database = openDatabase();
  const firstCalendar = database.createCalendar({ name: "First calendar" });
  const secondCalendar = database.createCalendar({ name: "Second calendar" });
  const firstExperiment = database.createExperiment({
    name: "First",
    color: "#112233",
    calendarId: firstCalendar.id,
  });
  const secondExperiment = database.createExperiment({
    name: "Second",
    color: "#445566",
    calendarId: secondCalendar.id,
  });
  const firstTask = database.createTask({
    name: "First task",
    date: "2026-08-14",
    experimentId: firstExperiment.id,
  });
  const secondTask = database.createTask({
    name: "Second task",
    date: "2026-08-17",
    experimentId: secondExperiment.id,
  });

  assert.deepEqual(
    database.listExperiments({ calendarId: firstCalendar.id }).map(({ id }) => id),
    [firstExperiment.id],
  );
  assert.deepEqual(
    database
      .listTasks({
        calendarId: firstCalendar.id,
        start: "2026-08-01",
        end: "2026-08-31",
      })
      .map(({ id }) => id),
    [firstTask.id],
  );
  assert.deepEqual(
    database.listTasks({ calendarId: secondCalendar.id }).map(({ id }) => id),
    [secondTask.id],
  );
  assert.equal(database.getCalendar(firstCalendar.id)?.experimentCount, 1);
  assert.equal(database.getCalendar(firstCalendar.id)?.taskCount, 1);

  const moved = database.updateExperiment(firstExperiment.id, {
    calendarId: secondCalendar.id,
  });
  assert.equal(moved?.calendarId, secondCalendar.id);
  assert.deepEqual(database.listTasks({ calendarId: firstCalendar.id }), []);
  assert.deepEqual(
    database.listTasks({ calendarId: secondCalendar.id }).map(({ id }) => id),
    [firstTask.id, secondTask.id],
  );
  assert.equal(database.getCalendar(firstCalendar.id)?.experimentCount, 0);
  assert.equal(database.getCalendar(secondCalendar.id)?.experimentCount, 2);
  assert.equal(database.getCalendar(secondCalendar.id)?.taskCount, 2);
});

test("requires archiving and then confirmation before cascading a calendar's contents", () => {
  const database = openDatabase();
  const calendar = database.createCalendar({ name: "Delete safely" });
  const experiment = database.createExperiment({
    name: "Cascading experiment",
    color: "#ABCDEF",
    calendarId: calendar.id,
  });
  const task = database.createTask({
    name: "Dependent task",
    date: "2026-08-14",
    experimentId: experiment.id,
  });

  const activeDeletion = database.deleteCalendar(calendar.id, {
    confirmCascade: true,
    expectedExperimentCount: 1,
    expectedTaskCount: 1,
  });
  assert.equal(activeDeletion.deleted, false);
  assert.equal(activeDeletion.archiveRequired, true);
  assert.ok(database.getCalendar(calendar.id));
  assert.ok(database.getExperiment(experiment.id));
  assert.ok(database.getTask(task.id));

  assert.equal(
    database.updateCalendar(calendar.id, { archived: true })?.archived,
    true,
  );
  const unconfirmed = database.deleteCalendar(calendar.id);
  assert.equal(unconfirmed.deleted, false);
  assert.notEqual(unconfirmed.archiveRequired, true);
  assert.equal(unconfirmed.experimentCount, 1);
  assert.equal(unconfirmed.taskCount, 1);
  assert.equal(unconfirmed.confirmationRequired, true);

  const secondExperiment = database.createExperiment({
    name: "Added after confirmation",
    color: "#FEDCBA",
    calendarId: calendar.id,
  });
  const stale = database.deleteCalendar(calendar.id, {
    confirmCascade: true,
    expectedExperimentCount: 1,
    expectedTaskCount: 1,
  });
  assert.equal(stale.deleted, false);
  assert.notEqual(stale.archiveRequired, true);
  assert.equal(stale.experimentCount, 2);
  assert.equal(stale.taskCount, 1);
  assert.equal(stale.confirmationRequired, true);
  assert.equal(stale.countsChanged, true);
  assert.ok(database.getCalendar(calendar.id));
  assert.ok(database.getExperiment(secondExperiment.id));

  assert.deepEqual(database.deleteCalendar(calendar.id, {
    confirmCascade: true,
    expectedExperimentCount: 2,
    expectedTaskCount: 1,
  }), {
    deleted: true,
    experimentCount: 2,
    taskCount: 1,
    confirmationRequired: false,
  });
  assert.equal(database.getCalendar(calendar.id), null);
  assert.equal(database.getExperiment(experiment.id), null);
  assert.equal(database.getTask(task.id), null);
});

test("requires archiving and then confirmation before cascading an experiment's tasks", () => {
  const database = openDatabase();
  const calendar = database.createCalendar({ name: "Experiment guard" });
  const experiment = database.createExperiment({
    name: "Delete only after confirmation",
    color: "#778899",
    calendarId: calendar.id,
  });
  const task = database.createTask({
    name: "Protected task",
    date: "2026-08-14",
    experimentId: experiment.id,
  });

  const activeDeletion = database.deleteExperiment(experiment.id, {
    confirmCascade: true,
    expectedTaskCount: 1,
  });
  assert.equal(activeDeletion.deleted, false);
  assert.equal(activeDeletion.archiveRequired, true);
  assert.ok(database.getTask(task.id));

  assert.equal(
    database.updateExperiment(experiment.id, { archived: true })?.archived,
    true,
  );
  const unconfirmed = database.deleteExperiment(experiment.id);
  assert.equal(unconfirmed.deleted, false);
  assert.notEqual(unconfirmed.archiveRequired, true);
  assert.equal(unconfirmed.taskCount, 1);
  assert.equal(unconfirmed.confirmationRequired, true);

  const secondTask = database.createTask({
    name: "Added after confirmation",
    date: "2026-08-15",
    experimentId: experiment.id,
  });
  const stale = database.deleteExperiment(experiment.id, {
    confirmCascade: true,
    expectedTaskCount: 1,
  });
  assert.equal(stale.deleted, false);
  assert.notEqual(stale.archiveRequired, true);
  assert.equal(stale.taskCount, 2);
  assert.equal(stale.confirmationRequired, true);
  assert.equal(stale.countsChanged, true);
  assert.ok(database.getTask(secondTask.id));

  assert.deepEqual(database.deleteExperiment(experiment.id, {
    confirmCascade: true,
    expectedTaskCount: 2,
  }), {
    deleted: true,
    taskCount: 2,
    confirmationRequired: false,
  });
  assert.equal(database.getExperiment(experiment.id), null);
  assert.equal(database.getTask(task.id), null);
  assert.equal(database.getCalendar(calendar.id)?.experimentCount, 0);
});

test("requires empty resources to be archived and lets unarchive restore the guard", () => {
  const database = openDatabase();
  const calendar = database.createCalendar({ name: "Empty calendar" });
  const experiment = database.createExperiment({
    name: "Empty experiment",
    color: "#123456",
    calendarId: calendar.id,
  });

  assert.equal(
    database.deleteExperiment(experiment.id, { confirmCascade: true }).archiveRequired,
    true,
  );
  database.updateExperiment(experiment.id, { archived: true });
  database.updateExperiment(experiment.id, { archived: false });
  assert.equal(database.deleteExperiment(experiment.id).archiveRequired, true);
  database.updateExperiment(experiment.id, { archived: true });
  assert.deepEqual(database.deleteExperiment(experiment.id, { confirmCascade: true }), {
    deleted: true,
    taskCount: 0,
    confirmationRequired: false,
  });

  assert.equal(database.deleteCalendar(calendar.id).archiveRequired, true);
  database.updateCalendar(calendar.id, { archived: true });
  database.updateCalendar(calendar.id, { archived: false });
  assert.equal(database.deleteCalendar(calendar.id).archiveRequired, true);
  database.updateCalendar(calendar.id, { archived: true });
  assert.deepEqual(database.deleteCalendar(calendar.id), {
    deleted: true,
    experimentCount: 0,
    taskCount: 0,
    confirmationRequired: false,
  });
});

test("rejects missing calendar references without changing existing data", () => {
  const database = openDatabase();
  const calendar = database.createCalendar({ name: "Valid calendar" });
  const experiment = database.createExperiment({
    name: "Stable experiment",
    color: "#123456",
    description: "Unchanged",
    calendarId: calendar.id,
  });

  assert.throws(
    () =>
      database.createExperiment({
        name: "Invalid",
        color: "#654321",
        calendarId: "missing-calendar",
      }),
    (error) =>
      error instanceof RelatedEntityNotFoundError && error.entity === "calendar",
  );
  assert.throws(
    () => database.updateExperiment(experiment.id, { calendarId: "missing-calendar" }),
    (error) =>
      error instanceof RelatedEntityNotFoundError && error.entity === "calendar",
  );
  assert.throws(
    () => database.listTasks({ calendarId: "missing-calendar" }),
    (error) =>
      error instanceof RelatedEntityNotFoundError && error.entity === "calendar",
  );
  assert.equal(database.getExperiment(experiment.id)?.calendarId, calendar.id);
  assert.equal(database.getExperiment(experiment.id)?.description, "Unchanged");
});
