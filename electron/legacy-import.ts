import { existsSync, mkdirSync, renameSync, rmSync, statSync } from "node:fs";
import { dirname, isAbsolute, resolve } from "node:path";
import { backup, DatabaseSync } from "node:sqlite";

const SUPPORTED_SCHEMA_VERSION = 3;

interface TableInfoRow {
  name: string;
  type: string;
  notnull: number;
  pk: number;
}

interface ForeignKeyRow {
  table: string;
  from: string;
  to: string;
  on_delete: string;
}

interface MigrationVersionRow {
  version: number;
}

interface ExpectedColumn {
  name: string;
  type: "INTEGER" | "TEXT";
  notNull: boolean;
  primaryKey?: boolean;
}

const calendarColumns: readonly ExpectedColumn[] = [
  { name: "id", type: "TEXT", notNull: true, primaryKey: true },
  { name: "name", type: "TEXT", notNull: true },
  { name: "created_at", type: "TEXT", notNull: true },
  { name: "updated_at", type: "TEXT", notNull: true },
];

const experimentColumnsV1: readonly ExpectedColumn[] = [
  { name: "id", type: "TEXT", notNull: true, primaryKey: true },
  { name: "name", type: "TEXT", notNull: true },
  { name: "color", type: "TEXT", notNull: true },
  { name: "description", type: "TEXT", notNull: false },
  { name: "created_at", type: "TEXT", notNull: true },
  { name: "updated_at", type: "TEXT", notNull: true },
];

const taskColumnsV1: readonly ExpectedColumn[] = [
  { name: "id", type: "TEXT", notNull: true, primaryKey: true },
  { name: "experiment_id", type: "TEXT", notNull: true },
  { name: "name", type: "TEXT", notNull: true },
  { name: "date", type: "TEXT", notNull: true },
  { name: "notes", type: "TEXT", notNull: false },
  { name: "created_at", type: "TEXT", notNull: true },
  { name: "updated_at", type: "TEXT", notNull: true },
];

const migrationColumns: readonly ExpectedColumn[] = [
  // SQLite reports an INTEGER PRIMARY KEY as nullable in table_info even
  // though it aliases the non-null rowid.
  { name: "version", type: "INTEGER", notNull: false, primaryKey: true },
  { name: "applied_at", type: "TEXT", notNull: true },
];

function schemaObjectExists(database: DatabaseSync, name: string): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 AS present FROM sqlite_schema WHERE name = ?")
      .get(name),
  );
}

function tableExists(database: DatabaseSync, table: string): boolean {
  return Boolean(
    database
      .prepare("SELECT 1 AS present FROM sqlite_schema WHERE type = 'table' AND name = ?")
      .get(table),
  );
}

function columnExists(database: DatabaseSync, table: string, column: string): boolean {
  const rows = database
    .prepare(`PRAGMA table_info("${table}")`)
    .all() as unknown as TableInfoRow[];
  return rows.some((row) => row.name === column);
}

function assertExpectedColumns(
  database: DatabaseSync,
  table: string,
  expectedColumns: readonly ExpectedColumn[],
): void {
  const rows = database
    .prepare(`PRAGMA table_info("${table}")`)
    .all() as unknown as TableInfoRow[];
  const columns = new Map(rows.map((row) => [row.name, row]));

  for (const expected of expectedColumns) {
    const actual = columns.get(expected.name);
    if (
      !actual
      || actual.type.toUpperCase() !== expected.type
      || Boolean(actual.notnull) !== expected.notNull
      || Boolean(actual.pk) !== Boolean(expected.primaryKey)
    ) {
      throw new Error(
        `Legacy database table ${table} does not have the supported ${expected.name} column.`,
      );
    }
  }
}

function assertExpectedForeignKey(
  database: DatabaseSync,
  table: string,
  expected: Omit<ForeignKeyRow, "on_delete"> & { on_delete: "CASCADE" },
): void {
  const rows = database
    .prepare(`PRAGMA foreign_key_list("${table}")`)
    .all() as unknown as ForeignKeyRow[];
  const matching = rows.some((row) => (
    row.table === expected.table
    && row.from === expected.from
    && row.to === expected.to
    && row.on_delete.toUpperCase() === expected.on_delete
  ));
  if (!matching) {
    throw new Error(
      `Legacy database table ${table} does not have the supported ${expected.from} relationship.`,
    );
  }
}

function assertMigrationMarkers(
  database: DatabaseSync,
  schemaVersion: number,
): void {
  if (!schemaObjectExists(database, "schema_migrations")) return;
  if (!tableExists(database, "schema_migrations")) {
    throw new Error("Legacy database has incompatible migration metadata.");
  }
  assertExpectedColumns(database, "schema_migrations", migrationColumns);

  const rows = database
    .prepare("SELECT version FROM schema_migrations ORDER BY version")
    .all() as unknown as MigrationVersionRow[];
  if (rows.length === 0) return;

  const versions = rows.map((row) => Number(row.version));
  const expected = Array.from({ length: schemaVersion }, (_, index) => index + 1);
  if (
    versions.length !== expected.length
    || versions.some((version, index) => version !== expected[index])
  ) {
    throw new Error("Legacy database has incompatible migration metadata.");
  }
}

function validateSupportedPlannerSchema(database: DatabaseSync): void {
  const versionRow = database.prepare("PRAGMA user_version").get() as
    | { user_version?: number }
    | undefined;
  const schemaVersion = Number(versionRow?.user_version);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1) {
    throw new Error("Legacy database is not a supported Experiment Planner database.");
  }
  if (schemaVersion > SUPPORTED_SCHEMA_VERSION) {
    throw new Error(
      `Legacy database schema version ${schemaVersion} is newer than the supported version ${SUPPORTED_SCHEMA_VERSION}.`,
    );
  }

  assertExpectedColumns(database, "experiments", [
    ...experimentColumnsV1,
    ...(schemaVersion >= 2
      ? [{ name: "calendar_id", type: "TEXT", notNull: false } as const]
      : []),
  ]);
  assertExpectedColumns(database, "tasks", [
    ...taskColumnsV1,
    ...(schemaVersion >= 3
      ? [{ name: "time", type: "TEXT", notNull: false } as const]
      : []),
  ]);
  assertExpectedForeignKey(database, "tasks", {
    table: "experiments",
    from: "experiment_id",
    to: "id",
    on_delete: "CASCADE",
  });

  if (schemaVersion === 1) {
    if (
      schemaObjectExists(database, "calendars")
      || schemaObjectExists(database, "experiments_by_calendar")
      || columnExists(database, "experiments", "calendar_id")
    ) {
      throw new Error("Legacy database has an incompatible version 1 schema.");
    }
  } else {
    assertExpectedColumns(database, "calendars", calendarColumns);
    assertExpectedForeignKey(database, "experiments", {
      table: "calendars",
      from: "calendar_id",
      to: "id",
      on_delete: "CASCADE",
    });
  }

  assertMigrationMarkers(database, schemaVersion);
}

function validateStagedDatabase(database: DatabaseSync): void {
  const integrityRows = database.prepare("PRAGMA quick_check").all() as unknown as Array<
    Record<string, unknown>
  >;
  const integrityResults = integrityRows.map((row) => String(Object.values(row)[0]));
  if (integrityResults.length !== 1 || integrityResults[0] !== "ok") {
    throw new Error("The staged legacy database did not pass SQLite's integrity check.");
  }

  validateSupportedPlannerSchema(database);

  const foreignKeyViolations = database
    .prepare("PRAGMA foreign_key_check")
    .all();
  if (foreignKeyViolations.length > 0) {
    throw new Error("The staged legacy database contains invalid relationships.");
  }
}

export function legacyImportPathFromArguments(arguments_: readonly string[]): string | null {
  const prefix = "--import-legacy-db=";
  const values = arguments_
    .filter((argument) => argument.startsWith(prefix))
    .map((argument) => argument.slice(prefix.length).trim());

  if (values.length === 0) return null;
  if (values.length > 1) {
    throw new Error("Pass --import-legacy-db only once.");
  }

  const [value] = values;
  if (!value || !isAbsolute(value)) {
    throw new Error("--import-legacy-db must contain an absolute SQLite file path.");
  }
  return resolve(value);
}

/**
 * Imports a pre-existing SQLite database without ever replacing destination.
 * SQLite's backup API includes committed WAL contents and produces a consistent
 * standalone file; the result is integrity-checked before an atomic rename.
 */
export async function importLegacyDatabaseIfRequested(
  destination: string,
  arguments_: readonly string[] = process.argv,
): Promise<"imported" | "not-requested" | "skipped-existing"> {
  const source = legacyImportPathFromArguments(arguments_);
  if (!source) return "not-requested";

  if (existsSync(destination)) {
    console.info(`Legacy import skipped because the destination database already exists: ${destination}`);
    return "skipped-existing";
  }
  if (!existsSync(source) || !statSync(source).isFile()) {
    throw new Error(`Legacy database does not exist or is not a file: ${source}`);
  }
  if (source === destination) {
    throw new Error("Legacy database source and destination must be different files.");
  }

  mkdirSync(dirname(destination), { recursive: true });
  const stagingPath = `${destination}.import-${process.pid}-${Date.now()}`;
  const sourceDatabase = new DatabaseSync(source, { readOnly: true });

  try {
    await backup(sourceDatabase, stagingPath);

    const stagedDatabase = new DatabaseSync(stagingPath, { readOnly: true });
    try {
      validateStagedDatabase(stagedDatabase);
    } finally {
      stagedDatabase.close();
    }

    // The Electron single-instance lock prevents another app process from
    // racing this check. Rechecking also protects against an external creator.
    if (existsSync(destination)) {
      console.info(`Legacy import skipped because the destination database appeared during import: ${destination}`);
      return "skipped-existing";
    }
    renameSync(stagingPath, destination);
    console.info(`Imported legacy database from ${source} to ${destination}`);
    return "imported";
  } finally {
    sourceDatabase.close();
    rmSync(stagingPath, { force: true });
    rmSync(`${stagingPath}-shm`, { force: true });
    rmSync(`${stagingPath}-wal`, { force: true });
  }
}
