import { randomUUID } from "node:crypto";
import { mkdirSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { fileURLToPath } from "node:url";

import type {
  Calendar,
  CalendarInput,
  Experiment,
  ExperimentInput,
  MigrationStatus,
  Task,
  TaskInput,
} from "../shared/models";

interface CalendarRow {
  id: string;
  name: string;
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
}

export interface CalendarDeletionResult {
  deleted: boolean;
  experimentCount: number;
  taskCount: number;
  confirmationRequired: boolean;
  countsChanged?: boolean;
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
] as const;

export const latestSupportedSchemaVersion = migrations.at(-1)?.version ?? 0;

function mapCalendar(row: CalendarRow): Calendar {
  return {
    id: row.id,
    name: row.name,
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
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

const calendarSelect = `
  SELECT
    c.id,
    c.name,
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

  constructor(path = getDatabasePath()) {
    this.path = path;
    if (path !== ":memory:") {
      mkdirSync(dirname(path), { recursive: true });
    }

    this.database = new DatabaseSync(path);
    try {
      // Reject databases created by a newer application before enabling WAL or
      // creating/updating any migration bookkeeping in this database.
      this.assertSupportedDatabaseVersion();
      this.database.exec("PRAGMA foreign_keys = ON");
      this.database.exec("PRAGMA busy_timeout = 5000");
      this.database.exec("PRAGMA journal_mode = WAL");
      this.database.exec("PRAGMA synchronous = FULL");
      this.migrate();
    } catch (error) {
      this.closed = true;
      this.database.close();
      throw error;
    }
  }

  private assertSupportedDatabaseVersion(): void {
    const versionRow = this.database.prepare("PRAGMA user_version").get() as
      | UserVersionRow
      | undefined;
    const userVersion = Number(versionRow?.user_version ?? 0);
    if (userVersion > latestSupportedSchemaVersion) {
      throw new UnsupportedDatabaseVersionError(
        "user_version",
        userVersion,
        latestSupportedSchemaVersion,
      );
    }

    const migrationTable = this.database
      .prepare(`
        SELECT 1 AS present
        FROM sqlite_schema
        WHERE type = 'table' AND name = 'schema_migrations'
      `)
      .get() as SqliteObjectRow | undefined;
    if (!migrationTable) return;

    const latestMigration = this.database
      .prepare("SELECT MAX(version) AS version FROM schema_migrations")
      .get() as MigrationRow | undefined;
    const recordedVersion = Number(latestMigration?.version ?? 0);
    if (recordedVersion > latestSupportedSchemaVersion) {
      throw new UnsupportedDatabaseVersionError(
        "schema_migrations",
        recordedVersion,
        latestSupportedSchemaVersion,
      );
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

  updateCalendar(id: string, input: Partial<CalendarInput>): Calendar | null {
    const existing = this.getCalendar(id);
    if (!existing) return null;
    this.database
      .prepare("UPDATE calendars SET name = ?, updated_at = ? WHERE id = ?")
      .run(input.name ?? existing.name, new Date().toISOString(), id);
    return this.getCalendar(id);
  }

  deleteCalendar(
    id: string,
    options: CalendarDeletionOptions = {},
  ): CalendarDeletionResult {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const exists = this.database
        .prepare("SELECT 1 AS value FROM calendars WHERE id = ?")
        .get(id);
      if (!exists) {
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
    input: Partial<ExperimentInput>,
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

    this.database
      .prepare(`
        UPDATE experiments
        SET name = ?, color = ?, description = ?, calendar_id = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(name, color, description, calendarId, updatedAt, id);

    return this.getExperiment(id);
  }

  deleteExperiment(
    id: string,
    options: ExperimentDeletionOptions = {},
  ): ExperimentDeletionResult {
    this.database.exec("BEGIN IMMEDIATE");
    try {
      const exists = this.database
        .prepare("SELECT 1 AS value FROM experiments WHERE id = ?")
        .get(id);
      if (!exists) {
        this.database.exec("COMMIT");
        return { deleted: false, taskCount: 0, confirmationRequired: false };
      }

      const countRow = this.database
        .prepare("SELECT COUNT(*) AS count FROM tasks WHERE experiment_id = ?")
        .get(id) as unknown as CountRow;
      const taskCount = Number(countRow.count);

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
          id, experiment_id, name, date, time, notes, created_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        id,
        input.experimentId,
        input.name,
        input.date,
        input.time ?? null,
        input.notes ?? null,
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

    this.database
      .prepare(`
        UPDATE tasks
        SET name = ?, date = ?, time = ?, experiment_id = ?, notes = ?, updated_at = ?
        WHERE id = ?
      `)
      .run(name, date, time, experimentId, notes, updatedAt, id);

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
