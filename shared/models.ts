export interface Calendar {
  id: string;
  name: string;
  archived: boolean;
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
  archived: boolean;
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
  completed: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface CalendarInput {
  name: string;
}

export type CalendarUpdateInput = Partial<CalendarInput> & {
  archived?: boolean;
};

export interface ExperimentInput {
  name: string;
  color: string;
  description?: string | null;
  calendarId: string;
}

export type ExperimentUpdateInput = Partial<ExperimentInput> & {
  archived?: boolean;
};

export interface TaskInput {
  name: string;
  date: string;
  time?: string | null;
  experimentId: string;
  notes?: string | null;
  completed?: boolean;
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
