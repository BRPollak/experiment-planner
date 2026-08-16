import type {
  CalendarInput,
  CalendarUpdateInput,
  ExperimentInput,
  ExperimentUpdateInput,
  TaskInput,
} from "../shared/models";

export class ValidationError extends Error {
  readonly details: Record<string, unknown>;

  constructor(message: string, details: Record<string, unknown> = {}) {
    super(message);
    this.name = "ValidationError";
    this.details = details;
  }
}

type JsonObject = Record<string, unknown>;

function requireObject(value: unknown): JsonObject {
  if (
    typeof value !== "object" ||
    value === null ||
    Array.isArray(value)
  ) {
    throw new ValidationError("Request body must be a JSON object.");
  }
  return value as JsonObject;
}

function rejectUnknownFields(object: JsonObject, allowed: readonly string[]): void {
  const unknown = Object.keys(object).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new ValidationError("Request contains unsupported fields.", {
      fields: unknown,
    });
  }
}

function requiredText(
  object: JsonObject,
  field: string,
  maximumLength: number,
): string {
  const value = object[field];
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new ValidationError(`${field} is required.`, { field });
  }
  const trimmed = value.trim();
  if (trimmed.length > maximumLength) {
    throw new ValidationError(
      `${field} must be at most ${maximumLength} characters.`,
      { field, maximumLength },
    );
  }
  return trimmed;
}

function optionalText(
  object: JsonObject,
  field: string,
  maximumLength: number,
): string | null | undefined {
  if (!Object.hasOwn(object, field)) return undefined;
  const value = object[field];
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new ValidationError(`${field} must be a string or null.`, { field });
  }
  const trimmed = value.trim();
  if (trimmed.length > maximumLength) {
    throw new ValidationError(
      `${field} must be at most ${maximumLength} characters.`,
      { field, maximumLength },
    );
  }
  return trimmed.length > 0 ? trimmed : null;
}

function color(object: JsonObject): string {
  const value = object.color;
  if (typeof value !== "string" || !/^#[0-9a-fA-F]{6}$/.test(value)) {
    throw new ValidationError("color must be a six-digit hexadecimal color.", {
      field: "color",
    });
  }
  return value.toUpperCase();
}

export function isCalendarDate(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const parsed = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(parsed.valueOf()) && parsed.toISOString().slice(0, 10) === value;
}

export function validateCalendarInput(value: unknown): CalendarInput {
  const object = requireObject(value);
  rejectUnknownFields(object, ["name"]);
  return { name: requiredText(object, "name", 120) };
}

export function validateCalendarUpdate(value: unknown): CalendarUpdateInput {
  const object = requireObject(value);
  rejectUnknownFields(object, ["name", "archived"]);
  if (Object.keys(object).length === 0) {
    throw new ValidationError("Provide at least one calendar field to update.");
  }

  const result: CalendarUpdateInput = {};
  if (Object.hasOwn(object, "name")) {
    result.name = requiredText(object, "name", 120);
  }
  if (Object.hasOwn(object, "archived")) {
    result.archived = optionalBoolean(object, "archived");
  }
  return result;
}

export function validateMigrationInput(value: unknown): { calendarId: string } {
  const object = requireObject(value);
  rejectUnknownFields(object, ["calendarId"]);
  return { calendarId: requiredText(object, "calendarId", 100) };
}

function calendarDate(object: JsonObject): string {
  const value = object.date;
  if (typeof value !== "string" || !isCalendarDate(value)) {
    throw new ValidationError("date must be a valid date in YYYY-MM-DD format.", {
      field: "date",
    });
  }
  return value;
}

function optionalTaskTime(object: JsonObject): string | null | undefined {
  if (!Object.hasOwn(object, "time")) return undefined;
  const value = object.time;
  if (value === null) return null;
  if (
    typeof value !== "string"
    || !/^(?:[01]\d|2[0-3]):(?:00|15|30|45)$/.test(value)
  ) {
    throw new ValidationError(
      "time must be null or a valid time in HH:mm format at a 15-minute increment.",
      { field: "time" },
    );
  }
  return value;
}

function optionalBoolean(object: JsonObject, field: string): boolean | undefined {
  if (!Object.hasOwn(object, field)) return undefined;
  const value = object[field];
  if (typeof value !== "boolean") {
    throw new ValidationError(`${field} must be a boolean.`, {
      field,
    });
  }
  return value;
}

export function validateExperimentInput(value: unknown): ExperimentInput {
  const object = requireObject(value);
  rejectUnknownFields(object, ["name", "color", "description", "calendarId"]);
  return {
    name: requiredText(object, "name", 120),
    color: color(object),
    description: optionalText(object, "description", 500),
    calendarId: requiredText(object, "calendarId", 100),
  };
}

export function validateExperimentUpdate(
  value: unknown,
): ExperimentUpdateInput {
  const object = requireObject(value);
  rejectUnknownFields(object, ["name", "color", "description", "calendarId", "archived"]);
  if (Object.keys(object).length === 0) {
    throw new ValidationError("Provide at least one experiment field to update.");
  }

  const result: ExperimentUpdateInput = {};
  if (Object.hasOwn(object, "name")) {
    result.name = requiredText(object, "name", 120);
  }
  if (Object.hasOwn(object, "color")) {
    result.color = color(object);
  }
  if (Object.hasOwn(object, "description")) {
    result.description = optionalText(object, "description", 500);
  }
  if (Object.hasOwn(object, "calendarId")) {
    result.calendarId = requiredText(object, "calendarId", 100);
  }
  if (Object.hasOwn(object, "archived")) {
    result.archived = optionalBoolean(object, "archived");
  }
  return result;
}

export function validateTaskInput(value: unknown): TaskInput {
  const object = requireObject(value);
  rejectUnknownFields(object, ["name", "date", "time", "experimentId", "notes", "completed"]);
  return {
    name: requiredText(object, "name", 200),
    date: calendarDate(object),
    time: optionalTaskTime(object),
    experimentId: requiredText(object, "experimentId", 100),
    notes: optionalText(object, "notes", 10_000),
    completed: optionalBoolean(object, "completed"),
  };
}

export function validateTaskUpdate(value: unknown): Partial<TaskInput> {
  const object = requireObject(value);
  rejectUnknownFields(object, ["name", "date", "time", "experimentId", "notes", "completed"]);
  if (Object.keys(object).length === 0) {
    throw new ValidationError("Provide at least one task field to update.");
  }

  const result: Partial<TaskInput> = {};
  if (Object.hasOwn(object, "name")) {
    result.name = requiredText(object, "name", 200);
  }
  if (Object.hasOwn(object, "date")) {
    result.date = calendarDate(object);
  }
  if (Object.hasOwn(object, "time")) {
    result.time = optionalTaskTime(object);
  }
  if (Object.hasOwn(object, "experimentId")) {
    result.experimentId = requiredText(object, "experimentId", 100);
  }
  if (Object.hasOwn(object, "notes")) {
    result.notes = optionalText(object, "notes", 10_000);
  }
  if (Object.hasOwn(object, "completed")) {
    result.completed = optionalBoolean(object, "completed");
  }
  return result;
}
