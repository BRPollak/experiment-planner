import type {
  ApiErrorBody,
  Task,
  TaskInput,
} from "../../shared/models";
import type {
  CalendarInput,
  MigrationStatus,
  PlannerCalendar,
  PlannerExperiment,
  PlannerExperimentInput,
} from "./types";

export class ApiError extends Error {
  readonly status: number;
  readonly code?: string;
  readonly details?: Record<string, unknown>;

  constructor(
    message: string,
    status: number,
    code?: string,
    details?: Record<string, unknown>,
  ) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
    this.details = details;
  }
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    ...init,
    headers: {
      ...(init?.body ? { "Content-Type": "application/json" } : {}),
      ...init?.headers,
    },
  });

  if (!response.ok) {
    let body: ApiErrorBody | undefined;
    try {
      body = (await response.json()) as ApiErrorBody;
    } catch {
      // The status text below still provides a useful fallback for non-JSON errors.
    }
    throw new ApiError(
      body?.error || response.statusText || "The request could not be completed.",
      response.status,
      body?.code,
      body?.details,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

function unwrapList<T>(value: T[] | Record<string, unknown>, key: string): T[] {
  if (Array.isArray(value)) return value;
  const nested = value[key];
  return Array.isArray(nested) ? (nested as T[]) : [];
}

function unwrapEntity<T>(value: T | Record<string, unknown>, key: string): T {
  if (value && typeof value === "object" && key in value) {
    return (value as Record<string, T>)[key];
  }
  return value as T;
}

export const plannerApi = {
  async listCalendars(signal?: AbortSignal): Promise<PlannerCalendar[]> {
    const result = await request<PlannerCalendar[] | Record<string, unknown>>(
      "/api/calendars",
      { signal },
    );
    return unwrapList<PlannerCalendar>(result, "calendars");
  },

  async createCalendar(input: CalendarInput): Promise<PlannerCalendar> {
    const result = await request<PlannerCalendar | Record<string, unknown>>(
      "/api/calendars",
      { method: "POST", body: JSON.stringify(input) },
    );
    return unwrapEntity<PlannerCalendar>(result, "calendar");
  },

  async updateCalendar(id: string, input: CalendarInput): Promise<PlannerCalendar> {
    const result = await request<PlannerCalendar | Record<string, unknown>>(
      `/api/calendars/${encodeURIComponent(id)}`,
      { method: "PUT", body: JSON.stringify(input) },
    );
    return unwrapEntity<PlannerCalendar>(result, "calendar");
  },

  async deleteCalendar(
    id: string,
    expected: { experimentCount: number; taskCount: number },
  ): Promise<void> {
    const query = new URLSearchParams({
      confirmCascade: "true",
      expectedExperimentCount: String(expected.experimentCount),
      expectedTaskCount: String(expected.taskCount),
    });
    await request<void>(
      `/api/calendars/${encodeURIComponent(id)}?${query.toString()}`,
      { method: "DELETE" },
    );
  },

  async getMigrationStatus(signal?: AbortSignal): Promise<MigrationStatus> {
    return request<MigrationStatus>("/api/migration", { signal });
  },

  async migrateLegacyData(calendarId: string): Promise<MigrationStatus> {
    return request<MigrationStatus>("/api/migration", {
      method: "POST",
      body: JSON.stringify({ calendarId }),
    });
  },

  async listExperiments(calendarId: string, signal?: AbortSignal): Promise<PlannerExperiment[]> {
    const query = new URLSearchParams({ calendarId });
    const result = await request<PlannerExperiment[] | Record<string, unknown>>(
      `/api/experiments?${query.toString()}`,
      { signal },
    );
    return unwrapList<PlannerExperiment>(result, "experiments");
  },

  async createExperiment(input: PlannerExperimentInput): Promise<PlannerExperiment> {
    const result = await request<PlannerExperiment | Record<string, unknown>>(
      "/api/experiments",
      { method: "POST", body: JSON.stringify(input) },
    );
    return unwrapEntity<PlannerExperiment>(result, "experiment");
  },

  async updateExperiment(id: string, input: PlannerExperimentInput): Promise<PlannerExperiment> {
    const result = await request<PlannerExperiment | Record<string, unknown>>(
      `/api/experiments/${encodeURIComponent(id)}`,
      { method: "PUT", body: JSON.stringify(input) },
    );
    return unwrapEntity<PlannerExperiment>(result, "experiment");
  },

  async deleteExperiment(id: string, expectedTaskCount: number): Promise<void> {
    const query = new URLSearchParams({
      confirmCascade: "true",
      expectedTaskCount: String(expectedTaskCount),
    });
    await request<void>(
      `/api/experiments/${encodeURIComponent(id)}?${query.toString()}`,
      { method: "DELETE" },
    );
  },

  async listTasks(
    range: { start: string; end: string; calendarId: string },
    signal?: AbortSignal,
  ): Promise<Task[]> {
    const query = new URLSearchParams({
      start: range.start,
      end: range.end,
      calendarId: range.calendarId,
    });
    const result = await request<Task[] | Record<string, unknown>>(
      `/api/tasks?${query.toString()}`,
      { signal },
    );
    return unwrapList<Task>(result, "tasks");
  },

  async createTask(input: TaskInput): Promise<Task> {
    const result = await request<Task | Record<string, unknown>>("/api/tasks", {
      method: "POST",
      body: JSON.stringify(input),
    });
    return unwrapEntity<Task>(result, "task");
  },

  async updateTask(id: string, input: Partial<TaskInput>): Promise<Task> {
    const result = await request<Task | Record<string, unknown>>(
      `/api/tasks/${encodeURIComponent(id)}`,
      { method: "PATCH", body: JSON.stringify(input) },
    );
    return unwrapEntity<Task>(result, "task");
  },

  async deleteTask(id: string): Promise<void> {
    await request<void>(`/api/tasks/${encodeURIComponent(id)}`, {
      method: "DELETE",
    });
  },
};

export function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return "Something went wrong. Please try again.";
}
