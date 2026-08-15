export interface Calendar {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  experimentCount: number;
  taskCount: number;
}

export interface Experiment {
  id: string;
  name: string;
  color: string;
  description: string | null;
  /** Null only for records retained from a pre-calendar database migration. */
  calendarId: string | null;
  createdAt: string;
  updatedAt: string;
  taskCount: number;
}

export interface Task {
  id: string;
  name: string;
  date: string;
  time: string | null;
  experimentId: string;
  notes: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarInput {
  name: string;
}

export interface ExperimentInput {
  name: string;
  color: string;
  description?: string | null;
  calendarId: string;
}

export interface TaskInput {
  name: string;
  date: string;
  time?: string | null;
  experimentId: string;
  notes?: string | null;
}

export interface ApiErrorBody {
  error: string;
  code?: string;
  details?: Record<string, unknown>;
}

export interface MigrationStatus {
  required: boolean;
  unassignedExperimentCount: number;
  unassignedTaskCount: number;
}
