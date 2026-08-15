export interface TaskSortable {
  /** Stable machine-readable local time in HH:mm format. */
  time?: string | null;
  /** Optional so tasks loaded from older persisted data remain sortable. */
  createdAt?: string | null;
}

export interface TaskGroupable extends TaskSortable {
  experimentId?: string | null;
}

export interface ExperimentGroupable {
  id: string;
}

export interface TaskExperimentGroup<
  TTask extends TaskGroupable,
  TExperiment extends ExperimentGroupable,
> {
  experimentId: string | null;
  experiment: TExperiment | null;
  tasks: TTask[];
}

interface DecoratedTask<TTask> {
  task: TTask;
  originalIndex: number;
  timeInMinutes: number | null;
  creationTimestamp: number | null;
}

export function isValidTaskTime(time: unknown): time is string {
  if (typeof time !== "string") return false;
  const match = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(time);
  return match !== null && Number(match[2]) % 15 === 0;
}

function taskTimeInMinutes(time: unknown): number | null {
  if (!isValidTaskTime(time)) return null;
  const [hours, minutes] = time.split(":").map(Number);
  return hours * 60 + minutes;
}

function creationTimestamp(createdAt: unknown): number | null {
  if (typeof createdAt !== "string" || createdAt.length === 0) return null;
  const timestamp = Date.parse(createdAt);
  return Number.isFinite(timestamp) ? timestamp : null;
}

/**
 * Returns a new array ordered for display within one calendar day.
 *
 * Legacy tasks without a usable creation timestamp are treated as older than
 * timestamped tasks and retain their incoming relative order. The API already
 * returns persisted tasks in stable order, so this preserves that order while
 * still allowing newly created tasks to sort by their real creation time.
 */
export function sortTasks<TTask extends TaskSortable>(tasks: readonly TTask[]): TTask[] {
  return tasks
    .map<DecoratedTask<TTask>>((task, originalIndex) => ({
      task,
      originalIndex,
      timeInMinutes: taskTimeInMinutes(task.time),
      creationTimestamp: creationTimestamp(task.createdAt),
    }))
    .sort((left, right) => {
      const leftIsTimed = left.timeInMinutes !== null;
      const rightIsTimed = right.timeInMinutes !== null;

      if (leftIsTimed !== rightIsTimed) return leftIsTimed ? -1 : 1;
      if (
        left.timeInMinutes !== null
        && right.timeInMinutes !== null
        && left.timeInMinutes !== right.timeInMinutes
      ) {
        return left.timeInMinutes - right.timeInMinutes;
      }

      const leftIsLegacy = left.creationTimestamp === null;
      const rightIsLegacy = right.creationTimestamp === null;
      if (leftIsLegacy !== rightIsLegacy) return leftIsLegacy ? -1 : 1;
      if (
        left.creationTimestamp !== null
        && right.creationTimestamp !== null
        && left.creationTimestamp !== right.creationTimestamp
      ) {
        return left.creationTimestamp - right.creationTimestamp;
      }

      return left.originalIndex - right.originalIndex;
    })
    .map(({ task }) => task);
}

export function formatTaskTime(
  time: string | null | undefined,
  locales?: Intl.LocalesArgument,
): string | null {
  if (!isValidTaskTime(time)) return null;
  const [hours, minutes] = time.split(":").map(Number);
  return new Intl.DateTimeFormat(locales, {
    hour: "numeric",
    minute: "2-digit",
  }).format(new Date(2000, 0, 1, hours, minutes));
}

export function filterTasksByExperiment<TTask extends TaskGroupable>(
  tasks: readonly TTask[],
  experimentId: string | null,
): TTask[] {
  return experimentId
    ? tasks.filter((task) => task.experimentId === experimentId)
    : [...tasks];
}

/**
 * Sorts globally first, then groups without changing each task's relative
 * position. Group order therefore follows the first task for each experiment.
 */
export function groupTasksByExperiment<
  TTask extends TaskGroupable,
  TExperiment extends ExperimentGroupable,
>(
  tasks: readonly TTask[],
  experiments: readonly TExperiment[],
): TaskExperimentGroup<TTask, TExperiment>[] {
  const experimentById = new Map(
    experiments.map((experiment) => [experiment.id, experiment] as const),
  );
  const groups = new Map<string | null, TaskExperimentGroup<TTask, TExperiment>>();

  sortTasks(tasks).forEach((task) => {
    const experiment = task.experimentId
      ? experimentById.get(task.experimentId) ?? null
      : null;
    const experimentId = experiment?.id ?? null;
    const existing = groups.get(experimentId);
    if (existing) {
      existing.tasks.push(task);
      return;
    }
    groups.set(experimentId, {
      experimentId,
      experiment,
      tasks: [task],
    });
  });

  return [...groups.values()];
}
