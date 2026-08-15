import { createReadStream, existsSync, statSync } from "node:fs";
import type { IncomingMessage, ServerResponse } from "node:http";
import { extname, resolve, sep } from "node:path";

import type { ApiErrorBody } from "../shared/models";
import {
  ExperimentPlannerDatabase,
  RelatedEntityNotFoundError,
  type CalendarDeletionOptions,
  type ExperimentDeletionOptions,
  type ExperimentFilters,
  type TaskFilters,
} from "./database";
import {
  isCalendarDate,
  validateCalendarInput,
  validateCalendarUpdate,
  validateExperimentInput,
  validateExperimentUpdate,
  validateMigrationInput,
  validateTaskInput,
  validateTaskUpdate,
  ValidationError,
} from "./validation";

const maximumBodyBytes = 1_000_000;

const contentTypes: Record<string, string> = {
  ".css": "text/css; charset=utf-8",
  ".html": "text/html; charset=utf-8",
  ".ico": "image/x-icon",
  ".js": "text/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".map": "application/json; charset=utf-8",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".webp": "image/webp",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
};

class HttpError extends Error {
  readonly status: number;
  readonly code: string;
  readonly details?: Record<string, unknown>;

  constructor(
    status: number,
    message: string,
    code: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "HttpError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

function sendJson(
  response: ServerResponse,
  status: number,
  body: unknown,
): void {
  const serialized = JSON.stringify(body);
  response.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Content-Length": Buffer.byteLength(serialized),
    "Cache-Control": "no-store",
  });
  response.end(serialized);
}

function sendNoContent(response: ServerResponse): void {
  response.writeHead(204, { "Cache-Control": "no-store" });
  response.end();
}

function sendError(
  response: ServerResponse,
  status: number,
  error: string,
  code: string,
  details?: Record<string, unknown>,
): void {
  const body: ApiErrorBody = { error, code };
  if (details) body.details = details;
  sendJson(response, status, body);
}

async function readJsonBody(request: IncomingMessage): Promise<unknown> {
  const contentType = request.headers["content-type"];
  if (contentType && !contentType.toLowerCase().startsWith("application/json")) {
    throw new HttpError(
      415,
      "Content-Type must be application/json.",
      "UNSUPPORTED_MEDIA_TYPE",
    );
  }

  const chunks: Buffer[] = [];
  let length = 0;
  for await (const chunk of request) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    length += buffer.length;
    if (length > maximumBodyBytes) {
      throw new HttpError(413, "Request body is too large.", "BODY_TOO_LARGE");
    }
    chunks.push(buffer);
  }

  if (length === 0) {
    throw new HttpError(400, "Request body is required.", "INVALID_JSON");
  }

  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new HttpError(400, "Request body is not valid JSON.", "INVALID_JSON");
  }
}

function validateQueryParameters(url: URL, allowedNames: readonly string[]): void {
  const allowed = new Set(allowedNames);
  const unknown = [...url.searchParams.keys()].filter((key) => !allowed.has(key));
  if (unknown.length > 0) {
    throw new ValidationError("Query contains unsupported parameters.", {
      parameters: [...new Set(unknown)],
    });
  }

  const repeated = allowedNames.filter(
    (name) => url.searchParams.getAll(name).length > 1,
  );
  if (repeated.length > 0) {
    throw new ValidationError("Query parameters may only be provided once.", {
      parameters: repeated,
    });
  }
}

function parseExperimentFilters(url: URL): ExperimentFilters {
  validateQueryParameters(url, ["calendarId"]);
  const calendarId = url.searchParams.get("calendarId") || undefined;
  if (url.searchParams.has("calendarId") && !calendarId) {
    throw new ValidationError("calendarId cannot be empty.", {
      field: "calendarId",
    });
  }
  return { calendarId };
}

function parseTaskFilters(url: URL): TaskFilters {
  validateQueryParameters(url, [
    "date",
    "start",
    "end",
    "experimentId",
    "calendarId",
  ]);

  const date = url.searchParams.get("date") || undefined;
  const start = url.searchParams.get("start") || undefined;
  const end = url.searchParams.get("end") || undefined;
  const experimentId = url.searchParams.get("experimentId") || undefined;
  const calendarId = url.searchParams.get("calendarId") || undefined;

  for (const [field, value] of Object.entries({ date, start, end })) {
    if (value && !isCalendarDate(value)) {
      throw new ValidationError(
        `${field} must be a valid date in YYYY-MM-DD format.`,
        { field },
      );
    }
  }
  if (date && (start || end)) {
    throw new ValidationError("date cannot be combined with start or end.");
  }
  if (start && end && start > end) {
    throw new ValidationError("start must be on or before end.");
  }
  if (url.searchParams.has("experimentId") && !experimentId) {
    throw new ValidationError("experimentId cannot be empty.", {
      field: "experimentId",
    });
  }
  if (url.searchParams.has("calendarId") && !calendarId) {
    throw new ValidationError("calendarId cannot be empty.", {
      field: "calendarId",
    });
  }

  return { date, start, end, experimentId, calendarId };
}

function parseCascadeConfirmation(url: URL): boolean {
  const value = url.searchParams.get("confirmCascade");
  if (value === null) return false;
  if (value !== "true" && value !== "false") {
    throw new ValidationError("confirmCascade must be true or false.", {
      field: "confirmCascade",
    });
  }
  return value === "true";
}

function parseExpectedCount(url: URL, field: string): number | undefined {
  const value = url.searchParams.get(field);
  if (value === null) return undefined;
  if (!/^(0|[1-9]\d*)$/.test(value)) {
    throw new ValidationError(`${field} must be a nonnegative integer.`, {
      field,
    });
  }

  const count = Number(value);
  if (!Number.isSafeInteger(count)) {
    throw new ValidationError(`${field} must be a safe nonnegative integer.`, {
      field,
    });
  }
  return count;
}

function parseExperimentDeletionOptions(url: URL): ExperimentDeletionOptions {
  validateQueryParameters(url, ["confirmCascade", "expectedTaskCount"]);
  return {
    confirmCascade: parseCascadeConfirmation(url),
    expectedTaskCount: parseExpectedCount(url, "expectedTaskCount"),
  };
}

function parseCalendarDeletionOptions(url: URL): CalendarDeletionOptions {
  validateQueryParameters(url, [
    "confirmCascade",
    "expectedExperimentCount",
    "expectedTaskCount",
  ]);
  return {
    confirmCascade: parseCascadeConfirmation(url),
    expectedExperimentCount: parseExpectedCount(url, "expectedExperimentCount"),
    expectedTaskCount: parseExpectedCount(url, "expectedTaskCount"),
  };
}

function decodeId(value: string): string {
  try {
    const decoded = decodeURIComponent(value);
    if (decoded.length === 0 || decoded.includes("/")) throw new Error();
    return decoded;
  } catch {
    throw new HttpError(400, "Resource ID is invalid.", "INVALID_ID");
  }
}

function serveFile(
  request: IncomingMessage,
  response: ServerResponse,
  filePath: string,
): void {
  const stat = statSync(filePath);
  response.writeHead(200, {
    "Content-Type": contentTypes[extname(filePath).toLowerCase()] ?? "application/octet-stream",
    "Content-Length": stat.size,
    "Cache-Control": filePath.endsWith("index.html")
      ? "no-cache"
      : "public, max-age=31536000, immutable",
  });
  if (request.method === "HEAD") {
    response.end();
    return;
  }
  createReadStream(filePath).pipe(response);
}

function serveStatic(
  request: IncomingMessage,
  response: ServerResponse,
  pathname: string,
  staticDirectory: string,
): void {
  let decodedPath: string;
  try {
    decodedPath = decodeURIComponent(pathname);
  } catch {
    throw new HttpError(400, "URL path is invalid.", "INVALID_PATH");
  }

  const root = resolve(staticDirectory);
  const requested = resolve(root, `.${decodedPath}`);
  if (requested !== root && !requested.startsWith(`${root}${sep}`)) {
    throw new HttpError(404, "Not found.", "NOT_FOUND");
  }

  if (existsSync(requested) && statSync(requested).isFile()) {
    serveFile(request, response, requested);
    return;
  }

  const indexPath = resolve(root, "index.html");
  if (existsSync(indexPath)) {
    serveFile(request, response, indexPath);
    return;
  }

  throw new HttpError(404, "Application build not found.", "STATIC_BUILD_NOT_FOUND");
}

export interface ApplicationOptions {
  database: ExperimentPlannerDatabase;
  production?: boolean;
  staticDirectory?: string;
}

export function createApplication(options: ApplicationOptions) {
  const { database } = options;

  return async function application(
    request: IncomingMessage,
    response: ServerResponse,
  ): Promise<void> {
    try {
      const method = request.method ?? "GET";
      const url = new URL(request.url ?? "/", "http://localhost");
      const pathname = url.pathname;

      if (method === "OPTIONS" && pathname.startsWith("/api/")) {
        response.writeHead(204, {
          Allow: "GET, POST, PUT, PATCH, DELETE, OPTIONS",
        });
        response.end();
        return;
      }

      if (pathname === "/api/health" && method === "GET") {
        validateQueryParameters(url, []);
        if (!database.ping()) {
          throw new HttpError(503, "Database is unavailable.", "DATABASE_UNAVAILABLE");
        }
        sendJson(response, 200, { status: "ok" });
        return;
      }

      if (pathname === "/api/calendars") {
        if (method === "GET") {
          validateQueryParameters(url, []);
          sendJson(response, 200, database.listCalendars());
          return;
        }
        if (method === "POST") {
          validateQueryParameters(url, []);
          const input = validateCalendarInput(await readJsonBody(request));
          sendJson(response, 201, database.createCalendar(input));
          return;
        }
      }

      const calendarMatch = pathname.match(/^\/api\/calendars\/([^/]+)$/);
      if (calendarMatch) {
        const id = decodeId(calendarMatch[1]);
        if (method === "GET") {
          validateQueryParameters(url, []);
          const calendar = database.getCalendar(id);
          if (!calendar) {
            throw new HttpError(404, "Calendar not found.", "CALENDAR_NOT_FOUND");
          }
          sendJson(response, 200, calendar);
          return;
        }
        if (method === "PATCH" || method === "PUT") {
          validateQueryParameters(url, []);
          const input = validateCalendarUpdate(await readJsonBody(request));
          const calendar = database.updateCalendar(id, input);
          if (!calendar) {
            throw new HttpError(404, "Calendar not found.", "CALENDAR_NOT_FOUND");
          }
          sendJson(response, 200, calendar);
          return;
        }
        if (method === "DELETE") {
          const result = database.deleteCalendar(
            id,
            parseCalendarDeletionOptions(url),
          );
          if (!result.deleted && result.confirmationRequired) {
            const countsChanged = result.countsChanged === true;
            throw new HttpError(
              409,
              countsChanged
                ? `This calendar's contents changed. It now contains ${result.experimentCount} experiment${result.experimentCount === 1 ? "" : "s"} and ${result.taskCount} task${result.taskCount === 1 ? "" : "s"}. Review the updated counts before deleting.`
                : `This calendar contains ${result.experimentCount} experiment${result.experimentCount === 1 ? "" : "s"} and ${result.taskCount} task${result.taskCount === 1 ? "" : "s"}. Confirm deletion to also delete all of its contents.`,
              countsChanged ? "CALENDAR_CONTENT_CHANGED" : "CALENDAR_HAS_CONTENT",
              {
                experimentCount: result.experimentCount,
                taskCount: result.taskCount,
                confirmationRequired: true,
                countsChanged,
              },
            );
          }
          if (!result.deleted) {
            throw new HttpError(404, "Calendar not found.", "CALENDAR_NOT_FOUND");
          }
          sendNoContent(response);
          return;
        }
      }

      if (pathname === "/api/migration") {
        if (method === "GET") {
          validateQueryParameters(url, []);
          sendJson(response, 200, database.getMigrationStatus());
          return;
        }
        if (method === "POST") {
          validateQueryParameters(url, []);
          const { calendarId } = validateMigrationInput(await readJsonBody(request));
          sendJson(response, 200, database.migrateUnassignedExperiments(calendarId));
          return;
        }
      }

      if (pathname === "/api/experiments") {
        if (method === "GET") {
          sendJson(response, 200, database.listExperiments(parseExperimentFilters(url)));
          return;
        }
        if (method === "POST") {
          validateQueryParameters(url, []);
          const input = validateExperimentInput(await readJsonBody(request));
          sendJson(response, 201, database.createExperiment(input));
          return;
        }
      }

      const experimentMatch = pathname.match(/^\/api\/experiments\/([^/]+)$/);
      if (experimentMatch) {
        const id = decodeId(experimentMatch[1]);
        if (method === "GET") {
          validateQueryParameters(url, []);
          const experiment = database.getExperiment(id);
          if (!experiment) {
            throw new HttpError(404, "Experiment not found.", "EXPERIMENT_NOT_FOUND");
          }
          sendJson(response, 200, experiment);
          return;
        }
        if (method === "PATCH" || method === "PUT") {
          validateQueryParameters(url, []);
          const input = validateExperimentUpdate(await readJsonBody(request));
          const experiment = database.updateExperiment(id, input);
          if (!experiment) {
            throw new HttpError(404, "Experiment not found.", "EXPERIMENT_NOT_FOUND");
          }
          sendJson(response, 200, experiment);
          return;
        }
        if (method === "DELETE") {
          const result = database.deleteExperiment(
            id,
            parseExperimentDeletionOptions(url),
          );
          if (!result.deleted && result.confirmationRequired) {
            const countsChanged = result.countsChanged === true;
            throw new HttpError(
              409,
              countsChanged
                ? `This experiment's contents changed. It now contains ${result.taskCount} task${result.taskCount === 1 ? "" : "s"}. Review the updated count before deleting.`
                : `This experiment contains ${result.taskCount} task${result.taskCount === 1 ? "" : "s"}. Confirm deletion to also delete its tasks.`,
              countsChanged ? "EXPERIMENT_CONTENT_CHANGED" : "EXPERIMENT_HAS_TASKS",
              {
                taskCount: result.taskCount,
                confirmationRequired: true,
                countsChanged,
              },
            );
          }
          if (!result.deleted) {
            throw new HttpError(404, "Experiment not found.", "EXPERIMENT_NOT_FOUND");
          }
          sendNoContent(response);
          return;
        }
      }

      if (pathname === "/api/tasks") {
        if (method === "GET") {
          sendJson(response, 200, database.listTasks(parseTaskFilters(url)));
          return;
        }
        if (method === "POST") {
          validateQueryParameters(url, []);
          const input = validateTaskInput(await readJsonBody(request));
          sendJson(response, 201, database.createTask(input));
          return;
        }
      }

      const taskMatch = pathname.match(/^\/api\/tasks\/([^/]+)$/);
      if (taskMatch) {
        const id = decodeId(taskMatch[1]);
        if (method === "GET") {
          validateQueryParameters(url, []);
          const task = database.getTask(id);
          if (!task) {
            throw new HttpError(404, "Task not found.", "TASK_NOT_FOUND");
          }
          sendJson(response, 200, task);
          return;
        }
        if (method === "PATCH" || method === "PUT") {
          validateQueryParameters(url, []);
          const input = validateTaskUpdate(await readJsonBody(request));
          const task = database.updateTask(id, input);
          if (!task) {
            throw new HttpError(404, "Task not found.", "TASK_NOT_FOUND");
          }
          sendJson(response, 200, task);
          return;
        }
        if (method === "DELETE") {
          validateQueryParameters(url, []);
          if (!database.deleteTask(id)) {
            throw new HttpError(404, "Task not found.", "TASK_NOT_FOUND");
          }
          sendNoContent(response);
          return;
        }
      }

      if (
        options.production &&
        (method === "GET" || method === "HEAD") &&
        !pathname.startsWith("/api/")
      ) {
        serveStatic(
          request,
          response,
          pathname,
          options.staticDirectory ?? resolve(process.cwd(), "dist"),
        );
        return;
      }

      throw new HttpError(404, "Not found.", "NOT_FOUND");
    } catch (error) {
      if (response.headersSent) {
        response.destroy(error instanceof Error ? error : undefined);
        return;
      }
      if (error instanceof ValidationError) {
        sendError(response, 400, error.message, "VALIDATION_ERROR", error.details);
        return;
      }
      if (error instanceof RelatedEntityNotFoundError) {
        const isCalendar = error.entity === "calendar";
        sendError(
          response,
          404,
          isCalendar ? "Calendar not found." : "Experiment not found.",
          isCalendar ? "CALENDAR_NOT_FOUND" : "EXPERIMENT_NOT_FOUND",
          isCalendar ? { calendarId: error.id } : { experimentId: error.id },
        );
        return;
      }
      if (error instanceof HttpError) {
        sendError(response, error.status, error.message, error.code, error.details);
        return;
      }

      console.error("Unhandled request error", error);
      sendError(response, 500, "Internal server error.", "INTERNAL_ERROR");
    }
  };
}
