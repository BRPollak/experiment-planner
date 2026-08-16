import type { Experiment, ExperimentInput } from "../../shared/models";

export interface PlannerCalendar {
  id: string;
  name: string;
  archived: boolean;
  createdAt: string;
  updatedAt: string;
  experimentCount: number;
  taskCount: number;
}

export interface CalendarInput {
  name: string;
}

export interface PlannerExperiment extends Experiment {
  calendarId: string | null;
}

export interface PlannerExperimentInput extends ExperimentInput {
  calendarId: string;
}

export interface MigrationStatus {
  required: boolean;
  unassignedExperimentCount: number;
  unassignedTaskCount: number;
}
