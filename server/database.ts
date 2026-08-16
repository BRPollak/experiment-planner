import { randomUUID } from "node:crypto";
import {
  chmodSync,
  closeSync,
  existsSync,
  fsyncSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readdirSync,
  renameSync,
  rmSync,
  statSync,
} from "node:fs";
import { basename, dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import type {
  Calendar,
  CalendarInput,
  CalendarUpdateInput,
  Experiment,
  ExperimentInput,
  ExperimentUpdateInput,
  MigrationStatus,
  Task,
  TaskInput,
} from "../shared/models";

interface CalendarRow {
  id: string;
  name: string;
  archived: number;
  created_at: string;
  updated_at: string;
  experiment_count: number;
  task_count: number;
}

interface ExperimentRow {
  id: string;
  name: string;
  color: string;
  description: string | null;
  archived: number;
  calendar_id: string | null;
  created_at: string;
  updated_at: string;
  task_count: number;
}

interface TaskRow {
  id: string;
  name: string;
  date: string;
  time: string | null;
  experiment_id: string;
  notes: string | null;
  completed: number;
  created_at: string;
  updated_at: string;
}

interface CountRow {
  count: number;
}

interface CalendarContentCountRow {
  experiment_count: number;
  task_count: number;
}

interface MigrationRow {
  version: number;
}

interface UserVersionRow {
  user_version: number;
}

interface SqliteObjectRow {
  present: number;
}

export interface ExperimentFilters {
  calendarId?: string;
}

export interface TaskFilters {
  date?: string;
  start?: string;
  end?: string;
  experimentId?: string;
  calendarId?: string;
}

export interface ExperimentDeletionResult {
  deleted: boolean;
  taskCount: number;
  confirmationRequired: boolean;
  countsChanged?: boolean;
  archiveRequired?: boolean;
}

export interface CalendarDeletionResult {
  deleted: boolean;
  experimentCount: number;
  taskCount: number;
  confirmationRequired: boolean;
  countsChanged?: boolean;
  archiveRequired?: boolean;
}

export interface ExperimentDeletionOptions {
  confirmCascade?: boolean;
  expectedTaskCount?: number;
}

export interface CalendarDeletionOptions {
  confirmCascade?: boolean;
  expectedExperimentCount?: number;
  expectedTaskCount?: number;
}

export class RelatedEntityNotFoundError extends Error {
  readonly entity: "calendar" | "experiment";
  readonly id: string;

  constructor(entity: "calendar" | "experiment", id: string) {
    super(`${entity} not found: ${id}`);
    this.name = "RelatedEntityNotFoundError";
    this.entity = entity;
    this.id = id;
  }
}

export class UnsupportedDatabaseVersionError extends Error {
  readonly source: "user_version" | "schema_migrations";
  readonly foundVersion: number;
  readonly latestSupportedVersion: number;

  constructor(
    source: "user_version" | "schema_migrations",
    foundVersion: number,
    latestSupportedVersion: number,
  ) {
    super(
      `Database ${source} is ${foundVersion}, but this application only supports schema versions through ${latestSupportedVersion}.`,
    );
    this.name = "UnsupportedDatabaseVersionError";
    this.source = source;
    this.foundVersion = foundVersion;
    this.latestSupportedVersion = latestSupportedVersion;
  }
}

export class MigrationBackupError extends Error {
  readonly databasePath: string;

  constructor(databasePath: string, cause: unknown) {
    const detail = cause instanceof Error ? cause.message : String(cause);
    super(
      `Could not create a verified pre-migration backup for ${databasePath}. `
      + `No migrations were applied. ${detail}`,
      { cause },
    );
    this.name = "MigrationBackupError";
    this.databasePath = databasePath;
  }
}

export class InvalidDatabaseMigrationStateError extends Error {
  readonly userVersion: number;
  readonly recordedVersions: readonly number[];

  constructor(
    userVersion: number,
    recordedVersions: readonly number[],
    reason: string,
  ) {
    super(`Database migration metadata is inconsistent: ${reason}`);
    this.name = "InvalidDatabaseMigrationStateError";
    this.userVersion = userVersion;
    this.recordedVersions = recordedVersions;
  }
}

const defaultDatabasePath = fileURLToPath(
  new URL("../data/experiment-planner.sqlite", import.meta.url),
);

export function getDatabasePath(): string {
  const configuredPath = process.env.EXPERIMENT_PLANNER_DB?.trim();
  return configuredPath ? resolve(configuredPath) : defaultDatabasePath;
}

const migrations = [
  {
    version: 1,
    sql: `
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
    `,
  },
  {
    version: 2,
    sql: `
      CREATE TABLE calendars (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        created_at TEXT NOT NULL,
        updated_at TEXT NOT NULL
      ) STRICT;

      ALTER TABLE experiments
        ADD COLUMN calendar_id TEXT
        REFERENCES calendars(id) ON DELETE CASCADE;

      CREATE INDEX experiments_by_calendar ON experiments(calendar_id);
    `,
  },
  {
    version: 3,
    sql: `
      ALTER TABLE tasks
        ADD COLUMN time TEXT
        CHECK (
          time IS NULL OR (
            length(time) = 5
            AND time GLOB '[0-2][0-9]:[0-5][0-9]'
            AND CAST(substr(time, 1, 2) AS INTEGER) BETWEEN 0 AND 23
            AND CAST(substr(time, 4, 2) AS INTEGER) IN (0, 15, 30, 45)
          )
        );
    `,
  },
  {
    version: 4,
    sql: `
      ALTER TABLE tasks
        ADD COLUMN completed INTEGER NOT NULL DEFAULT 0
      CHECK (completed IN (0, 1));
    `,
  },
  {
    version: 5,
    sql: `
      ALTER TABLE calendars
        ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
        CHECK (archived IN (0, 1));

      ALTER TABLE experiments
        ADD COLUMN archived INTEGER NOT NULL DEFAULT 0
        CHECK (archived IN (0, 1));
    `,
  },
] as const;

export const latestSupportedSchemaVersion = migrations.at(-1)?.version ?? 0;
export const migrationBackupRetention = 3;

interface MigrationBackupPlan {
  required: boolean;
  sourceVersion: number;
}

function readUserVersion(database: DatabaseSync): number {
  const versionRow = database.prepare("PRAGMA user_version").get() as
    | UserVersionRow
    | undefined;
  return Number(versionRow?.user_version ?? 0);
}

function hasMigrationTable(database: DatabaseSync): boolean {
  return Boolean(
    database
      .prepare(`
        SELECT 1 AS present
        FROM sqlite_schema
        WHERE type = 'table' AND name = 'schema_migrations'
      `)
      .get() as SqliteObjectRow | undefined,
  );
}

function schemaColumnNames(database: DatabaseSync, table: string): string[] {
  return (database
    .prepare(`PRAGMA table_info("${table}")`)
    .all() as unknown as Array<{ name: string }>).map((row) => row.name);
}

function assertSchemaMatchesVersion(
  database: DatabaseSync,
  userVersion: number,
  recordedVersions: readonly number[] = [],
): void {
  if (userVersion === 0) return;

  const expectedColumns = new Map<string, readonly string[]>([
    [
      "experiments",
      [
        "id",
        "name",
        "color",
        "description",
        "created_at",
        "updated_at",
        ...(userVersion >= 2 ? ["calendar_id"] : []),
        ...(userVersion >= 5 ? ["archived"] : []),
      ],
    ],
    [
      "tasks",
      [
        "id",
        "experiment_id",
        "name",
        "date",
        "notes",
        "created_at",
        "updated_at",
        ...(userVersion >= 3 ? ["time"] : []),
        ...(userVersion >= 4 ? ["completed"] : []),
      ],
    ],
    [
      "calendars",
      userVersion >= 2
        ? [
            "id",
            "name",
            "created_at",
            "updated_at",
            ...(userVersion >= 5 ? ["archived"] : []),
          ]
        : [],
    ],
  ]);

  const mismatchedTables: string[] = [];
  for (const [table, expected] of expectedColumns) {
    const actual = schemaColumnNames(database, table);
    if (
      actual.length !== expected.length
      || expected.some((column) => !actual.includes(column))
    ) {
      mismatchedTables.push(table);
    }
  }
  if (mismatchedTables.length > 0) {
    throw new InvalidDatabaseMigrationStateError(
      userVersion,
      recordedVersions,
      `the schema does not match PRAGMA user_version ${userVersion} `
      + `(mismatched tables: ${mismatchedTables.join(", ")}).`,
    );
  }
}

function assertSupportedDatabaseVersion(database: DatabaseSync): void {
  const userVersion = readUserVersion(database);
  if (userVersion > latestSupportedSchemaVersion) {
    throw new UnsupportedDatabaseVersionError(
      "user_version",
      userVersion,
      latestSupportedSchemaVersion,
    );
  }

  if (!hasMigrationTable(database)) {
    assertSchemaMatchesVersion(database, userVersion);
    return;
  }

  const rows = database
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all() as unknown as MigrationRow[];
  const recordedVersions = rows.map((row) => Number(row.version));
  const recordedVersion = recordedVersions.at(-1) ?? 0;
  if (recordedVersion > latestSupportedSchemaVersion) {
    throw new UnsupportedDatabaseVersionError(
      "schema_migrations",
      recordedVersion,
      latestSupportedSchemaVersion,
    );
  }

  // An empty bookkeeping table is recoverable from user_version. Once markers
  // exist, however, they must describe exactly the same contiguous history.
  if (recordedVersions.length === 0) {
    assertSchemaMatchesVersion(database, userVersion);
    return;
  }
  const expectedVersions = Array.from(
    { length: recordedVersion },
    (_, index) => index + 1,
  );
  if (
    recordedVersions.length !== expectedVersions.length
    || recordedVersions.some((version, index) => version !== expectedVersions[index])
  ) {
    throw new InvalidDatabaseMigrationStateError(
      userVersion,
      recordedVersions,
      `schema_migrations must be a contiguous prefix beginning with version 1; found [${recordedVersions.join(", ")}].`,
    );
  }
  if (recordedVersion !== userVersion) {
    throw new InvalidDatabaseMigrationStateError(
      userVersion,
      recordedVersions,
      `PRAGMA user_version is ${userVersion}, but the latest migration marker is ${recordedVersion}.`,
    );
  }
  assertSchemaMatchesVersion(database, userVersion, recordedVersions);
}

function migrationBackupPlan(database: DatabaseSync): MigrationBackupPlan {
  assertSupportedDatabaseVersion(database);
  const sourceVersion = readUserVersion(database);
  const migrationTablePresent = hasMigrationTable(database);
  let appliedVersions: Set<number>;

  if (migrationTablePresent) {
    const rows = database
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as unknown as MigrationRow[];
    appliedVersions = rows.length > 0
      ? new Set(rows.map((row) => Number(row.version)))
      : new Set(
        migrations
          .filter((migration) => migration.version <= sourceVersion)
          .map((migration) => migration.version),
      );
  } else {
    appliedVersions = new Set(
      migrations
        .filter((migration) => migration.version <= sourceVersion)
        .map((migration) => migration.version),
    );
  }

  const hasApplicationObjects = Boolean(
    database
      .prepare(`
        SELECT 1 AS present
        FROM sqlite_schema
        WHERE type IN ('table', 'index', 'view', 'trigger')
          AND name NOT LIKE 'sqlite_%'
        LIMIT 1
      `)
      .get() as SqliteObjectRow | undefined,
  );
  return {
    required: hasApplicationObjects
      && migrations.some((migration) => !appliedVersions.has(migration.version)),
    sourceVersion,
  };
}

function assertBackupIntegrity(backupPath: string): void {
  const backupDatabase = new DatabaseSync(backupPath, { readOnly: true });
  try {
    const integrityRows = backupDatabase
      .prepare("PRAGMA quick_check")
      .all() as unknown as Array<Record<string, unknown>>;
    const integrityResults = integrityRows.map((row) => String(Object.values(row)[0]));
    if (integrityResults.length !== 1 || integrityResults[0] !== "ok") {
      throw new Error("The backup did not pass SQLite's integrity check.");
    }

    const foreignKeyViolations = backupDatabase
      .prepare("PRAGMA foreign_key_check")
      .all();
    if (foreignKeyViolations.length > 0) {
      throw new Error("The backup contains invalid relationships.");
    }
  } finally {
    backupDatabase.close();
  }
}

function assertCurrentDatabaseIntegrity(database: DatabaseSync): void {
  const integrityRows = database
    .prepare("PRAGMA quick_check")
    .all() as unknown as Array<Record<string, unknown>>;
  const integrityResults = integrityRows.map((row) => String(Object.values(row)[0]));
  if (integrityResults.length !== 1 || integrityResults[0] !== "ok") {
    throw new Error("The migrated database did not pass SQLite's integrity check.");
  }
  if (database.prepare("PRAGMA foreign_key_check").all().length > 0) {
    throw new Error("The migrated database contains invalid relationships.");
  }

  assertSupportedDatabaseVersion(database);
  const userVersion = readUserVersion(database);
  if (userVersion !== latestSupportedSchemaVersion) {
    throw new InvalidDatabaseMigrationStateError(
      userVersion,
      [],
      `migration stopped at version ${userVersion}; expected ${latestSupportedSchemaVersion}.`,
    );
  }
}

async function writeDatabaseSnapshot(
  sourceDatabase: DatabaseSync,
  destinationPath: string,
): Promise<void> {
  const sqlite = await import("node:sqlite");
  if (typeof sqlite.backup === "function") {
    await sqlite.backup(sourceDatabase, destinationPath);
    return;
  }

  // Node 22 releases before backup() was added still support VACUUM INTO.
  // It operates on this connection's consistent snapshot, including committed
  // WAL pages, and writes a standalone database without changing the source.
  sourceDatabase.prepare("VACUUM INTO ?").run(destinationPath);
}

function removeDatabaseArtifacts(path: string): void {
  rmSync(path, { force: true });
  rmSync(`${path}-shm`, { force: true });
  rmSync(`${path}-wal`, { force: true });
}

function syncPath(path: string): void {
  const descriptor = openSync(path, "r");
  try {
    fsyncSync(descriptor);
  } finally {
    closeSync(descriptor);
  }
}

function escapeRegularExpression(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function pruneMigrationBackups(databasePath: string, protectedPath: string): void {
  const directory = dirname(databasePath);
  const managedBackupName = new RegExp(
    `^${escapeRegularExpression(basename(databasePath))}`
    + "\\.pre-migration-v[0-9]+-to-v[0-9]+-"
    + "[0-9TZ-]+-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-"
    + "[0-9a-f]{4}-[0-9a-f]{12}\\.sqlite$",
  );
  const protectedBackupPath = resolve(protectedPath);
  const candidates = readdirSync(directory, { withFileTypes: true })
    .filter((entry) => (
      entry.isFile()
      && managedBackupName.test(entry.name)
    ))
    .map((entry) => {
      const path = resolve(directory, entry.name);
      return { path, modifiedAt: statSync(path).mtimeMs };
    })
    .sort((left, right) => {
      if (left.path === protectedBackupPath) return -1;
      if (right.path === protectedBackupPath) return 1;
      return right.modifiedAt - left.modifiedAt || right.path.localeCompare(left.path);
    });

  for (const candidate of candidates.slice(migrationBackupRetention)) {
    removeDatabaseArtifacts(candidate.path);
  }
}

async function createMigrationBackupIfRequired(
  databasePath: string,
): Promise<string | null> {
  if (databasePath === ":memory:" || !existsSync(databasePath)) return null;

  const sourceDatabase = new DatabaseSync(databasePath, { readOnly: true });
  try {
    const plan = migrationBackupPlan(sourceDatabase);
    if (!plan.required) return null;

    const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
    const backupPath = `${databasePath}.pre-migration-v${plan.sourceVersion}`
      + `-to-v${latestSupportedSchemaVersion}-${timestamp}-${randomUUID()}.sqlite`;
    const stagingDirectory = mkdtempSync(
      resolve(dirname(databasePath), ".experiment-planner-backup-"),
    );
    chmodSync(stagingDirectory, 0o700);
    const stagingPath = resolve(stagingDirectory, "snapshot.sqlite");

    try {
      await writeDatabaseSnapshot(sourceDatabase, stagingPath);
      chmodSync(stagingPath, 0o600);
      assertBackupIntegrity(stagingPath);
      syncPath(stagingPath);
      renameSync(stagingPath, backupPath);
      syncPath(dirname(databasePath));
      console.info(`Created verified pre-migration backup: ${backupPath}`);
      return backupPath;
    } catch (error) {
      removeDatabaseArtifacts(stagingPath);
      throw new MigrationBackupError(databasePath, error);
    } finally {
      rmSync(stagingDirectory, { recursive: true, force: true });
    }
  } finally {
    sourceDatabase.close();
  }
}

function mapCalendar(row: CalendarRow): Calendar {
  return {
    id: row.id,
    name: row.name,
    archived: row.archived === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    experimentCount: Number(row.experiment_count),
    taskCount: Number(row.task_count),
  };
}

function mapExperiment(row: ExperimentRow): Experiment {
  return {
    id: row.id,
    name: row.name,
    color: row.color,
    description: row.description,
    archived: row.archived === 1,
    calendarId: row.calendar_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    taskCount: Number(row.task_count),
  };
}

function mapTask(row: TaskRow): Task {
  return {
    id: row.id,
    name: row.name,
    date: row.date,
    time: row.time,
    experimentId: row.experiment_id,
    notes: row.notes,
    completed: row.completed === 1,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const calendarSelect = `
  SELECT
    c.id,
    c.name,
    c.archived,
    c.created_at,
    c.updated_at,
    COUNT(DISTINCT e.id) AS experiment_count,
    COUNT(t.id) AS task_count
  FROM calendars AS c
  LEFT JOIN experiments AS e ON e.calendar_id = c.id
  LEFT JOIN tasks AS t ON t.experiment_id = e.id
`;

const experimentSelect = `
  SELECT
    e.id,
    e.name,
    e.color,
    e.description,
    e.archived,
    e.calendar_id,
    e.created_at,
    e.updated_at,
    COUNT(t.id) AS task_count
  FROM experiments AS e
  LEFT JOIN tasks AS t ON t.experiment_id = e.id
`;

const taskSelect = `
  SELECT
    t.id,
    t.name,
    t.date,
    t.time,
    t.experiment_id,
    t.notes,
    t.completed,
    t.created_at,
    t.updated_at
  FROM tasks AS t
  INNER JOIN experiments AS e ON e.id = t.experiment_id
`;

/**
 * Synchronous data-access layer for the local, single-user application.
 * SQLite serializes writes, while WAL keeps reads responsive during a write.
 */
export class ExperimentPlannerDatabase {
  readonly path: string;
  private readonly database: DatabaseSync;
  private closed = false;

  /**
   * Opens a durable database after preserving a verified snapshot whenever its
   * schema needs to advance. Callers that can await startup should prefer this
   * over the synchronous constructor.
   */
  static async open(path = getDatabasePath()): Promise<ExperimentPlannerDatabase> {
    const backupPath = await createMigrationBackupIfRequired(path);
    let database: ExperimentPlannerDatabase;
    try {
      database = new ExperimentPlannerDatabase(path);
    } catch (error) {
      if (!backupPath) throw error;
      const detail = error instanceof Error ? error.message : String(error);
      throw new Error(
        `Database migration failed. The verified pre-migration backup is at `
        + `${backupPath}. ${detail}`,
        { cause: error },
      );
    }

    if (backupPath) {
      try {
        pruneMigrationBackups(path, backupPath);
      } catch (error) {
        // The source is already migrated and the new verified backup exists.
        // A retention failure must not turn a successful migration into an
        // apparent startup failure or prompt unsafe migration retries.
        console.warn("Could not prune old migration backups", error);
      }
    }
    return database;
  }

  constructor(path = getDatabasePath()) {
    this.path = path;
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }

    this.database = new DatabaseSync(path);
    try {
      // Reject databases created by a newer application before enabling WAL or
      // creating/updating any migration bookkeeping in this database.
      assertSupportedDatabaseVersion(this.database);
      this.database.exec("PRAGMA foreign_keys = ON");
      this.database.exec("PRAGMA busy_timeout = 5000");
      this.database.exec("PRAGMA journal_mode = WAL");
      this.database.exec("PRAGMA synchronous = FULL");
      this.migrate();
      assertCurrentDatabaseIntegrity(this.database);
    } catch (error) {
      this.closed = true;
      this.database.close();
      throw error;
    }
  }

  private migrate(): void {
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS schema_migrations (
        version INTEGER PRIMARY KEY,
        applied_at TEXT NOT NULL
      ) STRICT;
    `);

    let appliedRows = this.database
      .prepare("SELECT version FROM schema_migrations ORDER BY version")
      .all() as unknown as MigrationRow[];

    // v1 already recorded user_version. Recover its migration marker if an
    // otherwise-valid legacy database lost only the bookkeeping table.
    if (appliedRows.length === 0) {
      const versionRow = this.database.prepare("PRAGMA user_version").get() as
        | UserVersionRow
        | undefined;
      const userVersion = Number(versionRow?.user_version ?? 0);
      for (const migration of migrations) {
        if (migration.version > userVersion) break;
        this.database
          .prepare(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
          )
          .run(migration.version, new Date().toISOString());
      }
      appliedRows = this.database
        .prepare("SELECT version FROM schema_migrations ORDER BY version")
        .all() as unknown as MigrationRow[];
    }

    const appliedVersions = new Set(appliedRows.map((row) => Number(row.version)));
    for (const migration of migrations) {
      if (appliedVersions.has(migration.version)) continue;

      this.database.exec("BEGIN IMMEDIATE");
      try {
        this.database.exec(migration.sql);
        this.database
          .prepare(
            "INSERT INTO schema_migrations (version, applied_at) VALUES (?, ?)",
          )
          .run(migration.version, new Date().toISOString());
        this.database.exec(`PRAGMA user_version = ${migration.version}`);
        this.database.exec("COMMIT");
      } catch (error) {
        this.database.exec("ROLLBACK");
        throw error;
      }
    }
  }

  private requireCalendar(id: string): void {
    const exists = this.database
      .prepare("SELECT 1 AS value FROM calendars WHERE id = ?")
      .get(id);
    if (!exists) throw new RelatedEntityNotFoundError("calendar", id);
  }

  ping(): boolean {
    const row = this.database.prepare("SELECT 1 AS value").get() as
      | { value: number }
      | undefined;
    return row?.value === 1;
  }

  listCalendars(): Calendar[] {
    const rows = this.database
      .prepare(`${calendarSelect} GROUP BY c.id ORDER BY c.created_at, c.id`)
      .all() as unknown as CalendarRow[];
    return rows.map(mapCalendar);
  }

  getCalendar(id: string): Calendar | null {
    const row = this.database
      .prepare(`${calendarSelect} WHERE c.id = ? GROUP BY c.id`)
      .get(id) as CalendarRow | undefined;
    return row ? mapCalendar(row) : null;
  }

  createCalendar(input: CalendarInput): Calendar {
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    this.database
      .prepare(`
        INSERT INTO calendars (id, name, created_at, updated_at)
        VALUES (?, ?, ?, ?)
      `)
      .run(id, input.name, timestamp, timestamp);
    return this.getCalendar(id)!;
  }

  updateCalendar(id: string, input: CalendarUpdateInput): Calendar | null {
    const existing = this.getCalendar(id);
    if (!existing) return null;
    this.database
      .prepare(
        "UPDATE calendars SET name = ?, archived = ?, updated_at = ? WHERE id = ?",
      )
      .run(
        input.name ?? existing.name,
        (input.archived ?? existing.archived) ? 1 : 0,
        new Date().toISOString(),
        id,
      );
    return this.getCalendar(id);
  }

  deleteCalendar(
    id: string,
    options: CalendarDeletionOptions = {},
  ): CalendarDeletionResult {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const calendar = this.database
        .prepare("SELECT archived FROM calendars WHERE id = ?")
        .get(id) as { archived: number } | undefined;
      if (!calendar) {
        this.database.exec("COMMIT");
        return {
          deleted: false,
          experimentCount: 0,
          taskCount: 0,
          confirmationRequired: false,
        };
      }

      const counts = this.database
        .prepare(`
          SELECT
            (SELECT COUNT(*) FROM experiments WHERE calendar_id = ?) AS experiment_count,
            (
              SELECT COUNT(*)
              FROM tasks AS t
              INNER JOIN experiments AS e ON e.id = t.experiment_id
              WHERE e.calendar_id = ?
            ) AS task_count
        `)
        .get(id, id) as unknown as CalendarContentCountRow;
      const experimentCount = Number(counts.experiment_count);
      const taskCount = Number(counts.task_count);

      if (calendar.archived !== 1) {
        this.database.exec("COMMIT");
        return {
          deleted: false,
          experimentCount,
          taskCount,
          confirmationRequired: false,
          archiveRequired: true,
        };
      }

      if (experimentCount > 0 || taskCount > 0) {
        if (!options.confirmCascade) {
          this.database.exec("COMMIT");
          return {
            deleted: false,
            experimentCount,
            taskCount,
            confirmationRequired: true,
          };
        }

        if (
          options.expectedExperimentCount !== experimentCount ||
          options.expectedTaskCount !== taskCount
        ) {
          this.database.exec("COMMIT");
          return {
            deleted: false,
            experimentCount,
            taskCount,
            confirmationRequired: true,
            countsChanged: true,
          };
        }
      }

      this.database.prepare("DELETE FROM calendars WHERE id = ?").run(id);
      this.database.exec("COMMIT");
      return {
        deleted: true,
        experimentCount,
        taskCount,
        confirmationRequired: false,
      };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  getMigrationStatus(): MigrationStatus {
    const experimentRow = this.database
      .prepare("SELECT COUNT(*) AS count FROM experiments WHERE calendar_id IS NULL")
      .get() as unknown as CountRow;
    const taskRow = this.database
      .prepare(`
        SELECT COUNT(*) AS count
        FROM tasks AS t
        INNER JOIN experiments AS e ON e.id = t.experiment_id
        WHERE e.calendar_id IS NULL
      `)
      .get() as unknown as CountRow;
    const unassignedExperimentCount = Number(experimentRow.count);
    const unassignedTaskCount = Number(taskRow.count);
    return {
      required: unassignedExperimentCount > 0,
      unassignedExperimentCount,
      unassignedTaskCount,
    };
  }

  migrateUnassignedExperiments(calendarId: string): MigrationStatus {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      this.requireCalendar(calendarId);
      this.database
        .prepare(`
          UPDATE experiments
          SET calendar_id = ?, updated_at = ?
          WHERE calendar_id IS NULL
        `)
        .run(calendarId, new Date().toISOString());
      this.database.exec("COMMIT");
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
    return this.getMigrationStatus();
  }

  listExperiments(filters: ExperimentFilters = {}): Experiment[] {
    const values: string[] = [];
    let where = "";
    if (filters.calendarId) {
      this.requireCalendar(filters.calendarId);
      where = " WHERE e.calendar_id = ?";
      values.push(filters.calendarId);
    }
    const rows = this.database
      .prepare(`${experimentSelect}${where} GROUP BY e.id ORDER BY e.created_at, e.id`)
      .all(...values) as unknown as ExperimentRow[];
    return rows.map(mapExperiment);
  }

  getExperiment(id: string): Experiment | null {
    const row = this.database
      .prepare(`${experimentSelect} WHERE e.id = ? GROUP BY e.id`)
      .get(id) as ExperimentRow | undefined;
    return row ? mapExperiment(row) : null;
  }

  createExperiment(input: ExperimentInput): Experiment {
    this.requireCalendar(input.calendarId);
    const id = randomUUID();
    const timestamp = new Date().toISOString();
    this.database
      .prepare(`
        INSERT INTO experiments (
          id, name, color, description, calendar_id, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.name,
        input.color,
        input.description ?? null,
        input.calendarId,
        timestamp,
        timestamp,
      );

    return this.getExperiment(id)!;
  }

  updateExperiment(
    id: string,
    input: ExperimentUpdateInput,
  ): Experiment | null {
    const existing = this.getExperiment(id);
    if (!existing) return null;

    const calendarId = input.calendarId ?? existing.calendarId;
    if (input.calendarId) this.requireCalendar(input.calendarId);
    const updatedAt = new Date().toISOString();
    const name = input.name ?? existing.name;
    const color = input.color ?? existing.color;
    const description = Object.hasOwn(input, "description")
      ? input.description ?? null
      : existing.description;
    const archived = input.archived ?? existing.archived;

    this.database
      .prepare(`
        UPDATE experiments
        SET name = ?, color = ?, description = ?, calendar_id = ?, archived = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(name, color, description, calendarId, archived ? 1 : 0, updatedAt, id);

    return this.getExperiment(id);
  }

  deleteExperiment(
    id: string,
    options: ExperimentDeletionOptions = {},
  ): ExperimentDeletionResult {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const experiment = this.database
        .prepare("SELECT archived FROM experiments WHERE id = ?")
        .get(id) as { archived: number } | undefined;
      if (!experiment) {
        this.database.exec("COMMIT");
        return { deleted: false, taskCount: 0, confirmationRequired: false };
      }

      const countRow = this.database
        .prepare("SELECT COUNT(*) AS count FROM tasks WHERE experiment_id = ?")
        .get(id) as unknown as CountRow;
      const taskCount = Number(countRow.count);

      if (experiment.archived !== 1) {
        this.database.exec("COMMIT");
        return {
          deleted: false,
          taskCount,
          confirmationRequired: false,
          archiveRequired: true,
        };
      }

      if (taskCount > 0) {
        if (!options.confirmCascade) {
          this.database.exec("COMMIT");
          return { deleted: false, taskCount, confirmationRequired: true };
        }

        if (options.expectedTaskCount !== taskCount) {
          this.database.exec("COMMIT");
          return {
            deleted: false,
            taskCount,
            confirmationRequired: true,
            countsChanged: true,
          };
        }
      }

      this.database.prepare("DELETE FROM experiments WHERE id = ?").run(id);
      this.database.exec("COMMIT");
      return { deleted: true, taskCount, confirmationRequired: false };
    } catch (error) {
      this.database.exec("ROLLBACK");
      throw error;
    }
  }

  listTasks(filters: TaskFilters = {}): Task[] {
    const clauses: string[] = [];
    const values: string[] = [];

    if (filters.calendarId) {
      this.requireCalendar(filters.calendarId);
      clauses.push("e.calendar_id = ?");
      values.push(filters.calendarId);
    }
    if (filters.date) {
      clauses.push("t.date = ?");
      values.push(filters.date);
    } else {
      if (filters.start) {
        clauses.push("t.date >= ?");
        values.push(filters.start);
      }
      if (filters.end) {
        clauses.push("t.date <= ?");
        values.push(filters.end);
      }
    }
    if (filters.experimentId) {
      clauses.push("t.experiment_id = ?");
      values.push(filters.experimentId);
    }

    const where = clauses.length > 0 ? ` WHERE ${clauses.join(" AND ")}` : "";
    const rows = this.database
      .prepare(`${taskSelect}${where} ORDER BY t.date, t.created_at, t.id`)
      .all(...values) as unknown as TaskRow[];
    return rows.map(mapTask);
  }

  getTask(id: string): Task | null {
    const row = this.database
      .prepare(`${taskSelect} WHERE t.id = ?`)
      .get(id) as TaskRow | undefined;
    return row ? mapTask(row) : null;
  }

  createTask(input: TaskInput): Task {
    if (!this.getExperiment(input.experimentId)) {
      throw new RelatedEntityNotFoundError("experiment", input.experimentId);
    }

    const id = randomUUID();
    const timestamp = new Date().toISOString();
    this.database
      .prepare(`
        INSERT INTO tasks (
          id, experiment_id, name, date, time, notes, completed, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.experimentId,
        input.name,
        input.date,
        input.time ?? null,
        input.notes ?? null,
        input.completed ? 1 : 0,
        timestamp,
        timestamp,
      );

    return this.getTask(id)!;
  }

  updateTask(id: string, input: Partial<TaskInput>): Task | null {
    const existing = this.getTask(id);
    if (!existing) return null;

    const experimentId = input.experimentId ?? existing.experimentId;
    if (!this.getExperiment(experimentId)) {
      throw new RelatedEntityNotFoundError("experiment", experimentId);
    }

    const updatedAt = new Date().toISOString();
    const name = input.name ?? existing.name;
    const date = input.date ?? existing.date;
    const time = Object.hasOwn(input, "time")
      ? input.time ?? null
      : existing.time;
    const notes = Object.hasOwn(input, "notes")
      ? input.notes ?? null
      : existing.notes;
    const completed = input.completed ?? existing.completed;

    this.database
      .prepare(`
        UPDATE tasks
        SET name = ?, date = ?, time = ?, experiment_id = ?, notes = ?, completed = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(name, date, time, experimentId, notes, completed ? 1 : 0, updatedAt, id);

    return this.getTask(id);
  }

  deleteTask(id: string): boolean {
    const result = this.database.prepare("DELETE FROM tasks WHERE id = ?").run(id);
    return Number(result.changes) > 0;
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    this.database.close();
  }
}
