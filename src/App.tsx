import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { ExperimentInput, Task, TaskInput } from "../shared/models";
import { CalendarEditor } from "./components/CalendarEditor";
import { ConfirmDialog } from "./components/ConfirmDialog";
import { DayView } from "./components/DayView";
import { ExperimentEditor } from "./components/ExperimentEditor";
import { ExperimentSidebar } from "./components/ExperimentSidebar";
import { CloseIcon } from "./components/Icons";
import { MigrationGate } from "./components/MigrationGate";
import { MonthCalendar } from "./components/MonthCalendar";
import { TaskEditor } from "./components/TaskEditor";
import { ApiError, errorMessage, plannerApi } from "./lib/api";
import { getCalendarRange } from "./lib/dates";
import { filterTasksByExperiment } from "./lib/tasks";
import type {
  CalendarInput,
  MigrationStatus,
  PlannerCalendar,
  PlannerExperiment,
} from "./lib/types";

type CalendarEditorState = { mode: "create" } | { mode: "edit"; calendar: PlannerCalendar };
type ExperimentEditorState = { mode: "create" } | { mode: "edit"; experiment: PlannerExperiment };
type TaskEditorState = {
  task?: Task;
  date: string;
  initialExperimentId?: string;
};

interface Notice {
  kind: "error" | "success";
  message: string;
}

function withTaskCount(
  experiment: PlannerExperiment,
  fallbackTaskCount = 0,
  fallbackCalendarId: string | null = null,
): PlannerExperiment {
  return {
    ...experiment,
    archived: experiment.archived === true,
    calendarId: experiment.calendarId ?? fallbackCalendarId,
    taskCount: Number.isFinite(experiment.taskCount) ? experiment.taskCount : fallbackTaskCount,
  };
}

function withCalendarCounts(calendar: PlannerCalendar, fallback?: PlannerCalendar): PlannerCalendar {
  return {
    ...calendar,
    archived: calendar.archived === true,
    experimentCount: Number.isFinite(calendar.experimentCount)
      ? calendar.experimentCount
      : fallback?.experimentCount ?? 0,
    taskCount: Number.isFinite(calendar.taskCount)
      ? calendar.taskCount
      : fallback?.taskCount ?? 0,
  };
}

function preferredCalendarId(calendars: PlannerCalendar[]): string | null {
  return calendars.find((calendar) => !calendar.archived)?.id
    ?? calendars[0]?.id
    ?? null;
}

export default function App() {
  const [calendars, setCalendars] = useState<PlannerCalendar[]>([]);
  const [selectedCalendarId, setSelectedCalendarId] = useState<string | null>(null);
  const [experiments, setExperiments] = useState<PlannerExperiment[]>([]);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [selectedExperimentId, setSelectedExperimentId] = useState<string | null>(null);
  const [month, setMonth] = useState(() => new Date());
  const [calendarsLoading, setCalendarsLoading] = useState(true);
  const [migrationStatus, setMigrationStatus] = useState<MigrationStatus | null>(null);
  const [experimentsLoading, setExperimentsLoading] = useState(false);
  const [tasksLoading, setTasksLoading] = useState(false);
  const [calendarEditor, setCalendarEditor] = useState<CalendarEditorState | null>(null);
  const [experimentEditor, setExperimentEditor] = useState<ExperimentEditorState | null>(null);
  const [taskEditor, setTaskEditor] = useState<TaskEditorState | null>(null);
  const [expandedDayDate, setExpandedDayDate] = useState<string | null>(null);
  const [calendarToDelete, setCalendarToDelete] = useState<PlannerCalendar | null>(null);
  const [experimentToDelete, setExperimentToDelete] = useState<PlannerExperiment | null>(null);
  const [taskToDelete, setTaskToDelete] = useState<Task | null>(null);
  const [pendingTaskDate, setPendingTaskDate] = useState<string | null>(null);
  const [notice, setNotice] = useState<Notice | null>(null);
  const [taskRevision, setTaskRevision] = useState(0);
  const [experimentRevision, setExperimentRevision] = useState(0);
  const [completingTaskIds, setCompletingTaskIds] = useState<ReadonlySet<string>>(() => new Set());
  const [movingTaskIds, setMovingTaskIds] = useState<ReadonlySet<string>>(() => new Set());
  const mutationGenerationRef = useRef(0);
  const activeTaskMutationsRef = useRef(0);
  const completingTaskIdsRef = useRef(new Set<string>());
  const movingTaskIdsRef = useRef(new Set<string>());
  const calendarRange = useMemo(() => getCalendarRange(month), [month]);

  const selectedCalendar = useMemo(
    () => calendars.find((calendar) => calendar.id === selectedCalendarId),
    [calendars, selectedCalendarId],
  );

  const showNotice = useCallback((next: Notice) => setNotice(next), []);

  useEffect(() => {
    if (!notice || notice.kind === "error") return;
    const timer = window.setTimeout(() => setNotice(null), 3200);
    return () => window.clearTimeout(timer);
  }, [notice]);

  useEffect(() => {
    const controller = new AbortController();
    setCalendarsLoading(true);
    Promise.all([
      plannerApi.listCalendars(controller.signal),
      plannerApi.getMigrationStatus(controller.signal),
    ])
      .then(([calendarItems, status]) => {
        const normalized = calendarItems.map((calendar) => withCalendarCounts(calendar));
        setCalendars(normalized);
        setMigrationStatus(status);
        setSelectedCalendarId((current) => (
          current && normalized.some((calendar) => calendar.id === current)
            ? current
            : preferredCalendarId(normalized)
        ));
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") {
          showNotice({ kind: "error", message: `Calendar workspaces could not be loaded. ${errorMessage(error)}` });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setCalendarsLoading(false);
      });
    return () => controller.abort();
  }, [showNotice]);

  useEffect(() => {
    if (!selectedCalendarId || migrationStatus?.required !== false) {
      setExperiments([]);
      setExperimentsLoading(false);
      return;
    }
    const controller = new AbortController();
    setExperimentsLoading(true);
    plannerApi.listExperiments(selectedCalendarId, controller.signal)
      .then((items) => {
        if (!controller.signal.aborted) {
          setExperiments(items.map((item) => withTaskCount(item, item.taskCount, selectedCalendarId)));
        }
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") {
          showNotice({ kind: "error", message: `Experiments could not be loaded. ${errorMessage(error)}` });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setExperimentsLoading(false);
      });
    return () => controller.abort();
  }, [experimentRevision, migrationStatus?.required, selectedCalendarId, showNotice]);

  useEffect(() => {
    if (!selectedCalendarId || migrationStatus?.required !== false) {
      setTasks([]);
      setTasksLoading(false);
      return;
    }
    const controller = new AbortController();
    const generationAtStart = mutationGenerationRef.current;
    setTasksLoading(true);
    plannerApi.listTasks({
      start: calendarRange.start,
      end: calendarRange.end,
      calendarId: selectedCalendarId,
    }, controller.signal)
      .then((items) => {
        if (
          !controller.signal.aborted
          && generationAtStart === mutationGenerationRef.current
          && activeTaskMutationsRef.current === 0
        ) {
          setTasks(items);
        }
      })
      .catch((error) => {
        if ((error as Error).name !== "AbortError") {
          showNotice({ kind: "error", message: `Calendar tasks could not be loaded. ${errorMessage(error)}` });
        }
      })
      .finally(() => {
        if (!controller.signal.aborted) setTasksLoading(false);
      });
    return () => controller.abort();
  }, [calendarRange.end, calendarRange.start, migrationStatus?.required, selectedCalendarId, showNotice, taskRevision]);

  useEffect(() => {
    if (selectedExperimentId && !experimentsLoading && !experiments.some((item) => item.id === selectedExperimentId)) {
      setSelectedExperimentId(null);
    }
  }, [experiments, experimentsLoading, selectedExperimentId]);

  const visibleTasks = useMemo(
    () => filterTasksByExperiment(tasks, selectedExperimentId),
    [selectedExperimentId, tasks],
  );

  const selectCalendar = useCallback((id: string) => {
    setSelectedCalendarId(id);
    setSelectedExperimentId(null);
    setExpandedDayDate(null);
    setExperiments([]);
    setTasks([]);
    setCompletingTaskIds(new Set());
    setMovingTaskIds(new Set());
    completingTaskIdsRef.current.clear();
    movingTaskIdsRef.current.clear();
  }, []);

  const changeCalendarCounts = useCallback((experimentDelta: number, taskDelta: number) => {
    if (!selectedCalendarId) return;
    setCalendars((current) => current.map((calendar) => (
      calendar.id === selectedCalendarId
        ? {
            ...calendar,
            experimentCount: Math.max(0, calendar.experimentCount + experimentDelta),
            taskCount: Math.max(0, calendar.taskCount + taskDelta),
          }
        : calendar
    )));
  }, [selectedCalendarId]);

  const changeExperimentTaskCount = useCallback((id: string, delta: number) => {
    setExperiments((current) => current.map((experiment) => (
      experiment.id === id
        ? { ...experiment, taskCount: Math.max(0, experiment.taskCount + delta) }
        : experiment
    )));
  }, []);

  const openCalendarCreator = useCallback(() => {
    setPendingTaskDate(null);
    setCalendarEditor({ mode: "create" });
  }, []);

  const openExperimentCreator = useCallback(() => {
    if (!selectedCalendarId) {
      setPendingTaskDate(null);
      setCalendarEditor({ mode: "create" });
      return;
    }
    setPendingTaskDate(null);
    setExperimentEditor({ mode: "create" });
  }, [selectedCalendarId]);

  const openTaskCreator = useCallback((date: string) => {
    if (calendarsLoading || migrationStatus?.required !== false) return;
    if (!selectedCalendarId) {
      setPendingTaskDate(date);
      setCalendarEditor({ mode: "create" });
      return;
    }
    if (experimentsLoading) {
      showNotice({ kind: "error", message: "Experiments are still loading. Try again in a moment." });
      return;
    }
    if (!experiments.length) {
      setPendingTaskDate(date);
      setExperimentEditor({ mode: "create" });
      return;
    }
    setTaskEditor({
      date,
      initialExperimentId: selectedExperimentId ?? experiments[0].id,
    });
  }, [calendarsLoading, experiments, experimentsLoading, migrationStatus?.required, selectedCalendarId, selectedExperimentId, showNotice]);

  const openTaskEditor = useCallback((task: Task) => {
    setTaskEditor({ task, date: task.date, initialExperimentId: task.experimentId });
  }, []);

  const openExpandedDay = useCallback((date: string) => {
    setExpandedDayDate(date);
  }, []);

  const closeExpandedDay = useCallback(() => {
    setExpandedDayDate(null);
  }, []);

  const changeMonth = useCallback((nextMonth: Date) => {
    setExpandedDayDate(null);
    setMonth(nextMonth);
  }, []);

  const saveCalendar = async (input: CalendarInput) => {
    if (calendarEditor?.mode === "edit") {
      const previous = calendarEditor.calendar;
      const updated = withCalendarCounts(await plannerApi.updateCalendar(previous.id, input), previous);
      setCalendars((current) => current.map((calendar) => calendar.id === previous.id ? updated : calendar));
      setCalendarEditor(null);
      showNotice({ kind: "success", message: "Calendar renamed." });
      return;
    }

    const created = withCalendarCounts(await plannerApi.createCalendar(input));
    setCalendars((current) => [...current, created]);
    selectCalendar(created.id);
    setCalendarEditor(null);
    showNotice({ kind: "success", message: "Calendar created." });
    if (pendingTaskDate) setExperimentEditor({ mode: "create" });
  };

  const changeCalendarArchiveState = async (
    calendar: PlannerCalendar,
    archived: boolean,
  ) => {
    const updated = withCalendarCounts(
      await plannerApi.setCalendarArchived(calendar.id, archived),
      calendar,
    );
    setCalendars((current) => current.map((item) => (
      item.id === calendar.id ? updated : item
    )));
    setCalendarEditor((current) => (
      current?.mode === "edit" && current.calendar.id === calendar.id ? null : current
    ));
    showNotice({
      kind: "success",
      message: archived ? `“${calendar.name}” was archived.` : `“${calendar.name}” was unarchived.`,
    });
  };

  const createMigrationCalendar = async (name: string) => {
    const created = withCalendarCounts(await plannerApi.createCalendar({ name }));
    setCalendars((current) => [...current, created]);
    setSelectedCalendarId((current) => current ?? created.id);
    return created;
  };

  const migrateLegacyData = async (calendarId: string) => {
    const status = await plannerApi.migrateLegacyData(calendarId);
    const refreshedCalendars = (await plannerApi.listCalendars()).map((calendar) => withCalendarCounts(calendar));
    setCalendars(refreshedCalendars);
    setMigrationStatus(status);
    selectCalendar(calendarId);
    setExperimentRevision((revision) => revision + 1);
    setTaskRevision((revision) => revision + 1);
    showNotice({ kind: "success", message: "Existing data migrated successfully." });
  };

  const deleteCalendar = async () => {
    if (!calendarToDelete) return;
    const deleted = calendarToDelete;
    try {
      await plannerApi.deleteCalendar(deleted.id, {
        experimentCount: deleted.experimentCount,
        taskCount: deleted.taskCount,
      });
    } catch (error) {
      if (error instanceof ApiError && error.code === "CALENDAR_CONTENT_CHANGED") {
        const experimentCount = error.details?.experimentCount;
        const taskCount = error.details?.taskCount;
        if (
          typeof experimentCount === "number"
          && Number.isSafeInteger(experimentCount)
          && typeof taskCount === "number"
          && Number.isSafeInteger(taskCount)
        ) {
          const refreshed = { ...deleted, experimentCount, taskCount };
          setCalendars((current) => current.map((calendar) => (
            calendar.id === deleted.id ? refreshed : calendar
          )));
          setCalendarToDelete(refreshed);
        }
      }
      throw error;
    }
    const remaining = calendars.filter((calendar) => calendar.id !== deleted.id);
    setCalendars(remaining);
    if (selectedCalendarId === deleted.id) {
      const nextId = preferredCalendarId(remaining);
      setSelectedCalendarId(nextId);
      setSelectedExperimentId(null);
      setExpandedDayDate(null);
      setExperiments([]);
      setTasks([]);
    }
    setCalendarToDelete(null);
    showNotice({ kind: "success", message: `“${deleted.name}” was deleted.` });
  };

  const saveExperiment = async (input: Omit<ExperimentInput, "calendarId">) => {
    if (!selectedCalendarId) throw new Error("Select a calendar before saving an experiment.");
    const scopedInput = { ...input, calendarId: selectedCalendarId };
    if (experimentEditor?.mode === "edit") {
      const previous = experimentEditor.experiment;
      const updated = withTaskCount(
        await plannerApi.updateExperiment(previous.id, scopedInput),
        previous.taskCount,
        selectedCalendarId,
      );
      setExperiments((current) => current.map((item) => item.id === previous.id ? updated : item));
      setExperimentEditor(null);
      showNotice({ kind: "success", message: "Experiment updated." });
      return;
    }

    const created = withTaskCount(await plannerApi.createExperiment(scopedInput), 0, selectedCalendarId);
    setExperiments((current) => [...current, created]);
    setSelectedExperimentId(created.id);
    changeCalendarCounts(1, 0);
    setExperimentEditor(null);
    showNotice({ kind: "success", message: "Experiment created." });
    if (pendingTaskDate) {
      setTaskEditor({ date: pendingTaskDate, initialExperimentId: created.id });
      setPendingTaskDate(null);
    }
  };

  const changeExperimentArchiveState = async (
    experiment: PlannerExperiment,
    archived: boolean,
  ) => {
    const updated = withTaskCount(
      await plannerApi.setExperimentArchived(experiment.id, archived),
      experiment.taskCount,
      experiment.calendarId,
    );
    setExperiments((current) => current.map((item) => (
      item.id === experiment.id ? updated : item
    )));
    setExperimentEditor((current) => (
      current?.mode === "edit" && current.experiment.id === experiment.id ? null : current
    ));
    showNotice({
      kind: "success",
      message: archived ? `“${experiment.name}” was archived.` : `“${experiment.name}” was unarchived.`,
    });
  };

  const requestExperimentDelete = (experiment: PlannerExperiment) => {
    if (!experiment.archived) return;
    setExperimentEditor(null);
    setExperimentToDelete(experiment);
  };

  const deleteExperiment = async () => {
    if (!experimentToDelete) return;
    const deleted = experimentToDelete;
    mutationGenerationRef.current += 1;
    activeTaskMutationsRef.current += 1;
    try {
      try {
        await plannerApi.deleteExperiment(deleted.id, deleted.taskCount);
      } catch (error) {
        if (error instanceof ApiError && error.code === "EXPERIMENT_CONTENT_CHANGED") {
          const taskCount = error.details?.taskCount;
          if (typeof taskCount === "number" && Number.isSafeInteger(taskCount)) {
            const refreshed = { ...deleted, taskCount };
            changeCalendarCounts(0, taskCount - deleted.taskCount);
            setExperiments((current) => current.map((experiment) => (
              experiment.id === deleted.id ? refreshed : experiment
            )));
            setExperimentToDelete(refreshed);
          }
        }
        throw error;
      }
      setExperiments((current) => current.filter((item) => item.id !== deleted.id));
      setTasks((current) => current.filter((task) => task.experimentId !== deleted.id));
      changeCalendarCounts(-1, -deleted.taskCount);
      if (selectedExperimentId === deleted.id) setSelectedExperimentId(null);
      setExperimentToDelete(null);
      showNotice({ kind: "success", message: `“${deleted.name}” was deleted.` });
    } finally {
      activeTaskMutationsRef.current = Math.max(0, activeTaskMutationsRef.current - 1);
      mutationGenerationRef.current += 1;
      setTaskRevision((revision) => revision + 1);
    }
  };

  const saveTask = async (input: TaskInput) => {
    mutationGenerationRef.current += 1;
    activeTaskMutationsRef.current += 1;
    try {
      if (taskEditor?.task) {
        const previous = taskEditor.task;
        const updated = await plannerApi.updateTask(previous.id, input);
        setTasks((current) => {
          const withoutPrevious = current.filter((task) => task.id !== previous.id);
          return updated.date >= calendarRange.start && updated.date <= calendarRange.end
            ? [...withoutPrevious, updated]
            : withoutPrevious;
        });
        if (previous.experimentId !== updated.experimentId) {
          changeExperimentTaskCount(previous.experimentId, -1);
          changeExperimentTaskCount(updated.experimentId, 1);
        }
        setTaskEditor(null);
        showNotice({ kind: "success", message: "Task updated." });
        return;
      }

      const created = await plannerApi.createTask(input);
      if (created.date >= calendarRange.start && created.date <= calendarRange.end) {
        setTasks((current) => [...current, created]);
      }
      changeExperimentTaskCount(created.experimentId, 1);
      changeCalendarCounts(0, 1);
      setTaskEditor(null);
      showNotice({ kind: "success", message: "Task created." });
    } finally {
      activeTaskMutationsRef.current = Math.max(0, activeTaskMutationsRef.current - 1);
      mutationGenerationRef.current += 1;
      setTaskRevision((revision) => revision + 1);
    }
  };

  const deleteTask = async () => {
    if (!taskToDelete) return;
    const deleted = taskToDelete;
    mutationGenerationRef.current += 1;
    activeTaskMutationsRef.current += 1;
    try {
      await plannerApi.deleteTask(deleted.id);
      setTasks((current) => current.filter((task) => task.id !== deleted.id));
      changeExperimentTaskCount(deleted.experimentId, -1);
      changeCalendarCounts(0, -1);
      setTaskToDelete(null);
      showNotice({ kind: "success", message: "Task deleted." });
    } finally {
      activeTaskMutationsRef.current = Math.max(0, activeTaskMutationsRef.current - 1);
      mutationGenerationRef.current += 1;
      setTaskRevision((revision) => revision + 1);
    }
  };

  const moveTask = useCallback(async (task: Task, date: string) => {
    if (movingTaskIdsRef.current.has(task.id)) return;
    movingTaskIdsRef.current.add(task.id);
    setMovingTaskIds(new Set(movingTaskIdsRef.current));
    mutationGenerationRef.current += 1;
    activeTaskMutationsRef.current += 1;
    const optimistic = { ...task, date };
    setTasks((current) => current.map((item) => item.id === task.id ? optimistic : item));
    try {
      const persisted = await plannerApi.updateTask(task.id, {
        date,
      });
      setTasks((current) => current.map((item) => item.id === task.id ? persisted : item));
    } catch (error) {
      setTasks((current) => current.map((item) => item.id === task.id ? task : item));
      showNotice({ kind: "error", message: `The task could not be moved. ${errorMessage(error)}` });
    } finally {
      activeTaskMutationsRef.current = Math.max(0, activeTaskMutationsRef.current - 1);
      mutationGenerationRef.current += 1;
      movingTaskIdsRef.current.delete(task.id);
      setMovingTaskIds(new Set(movingTaskIdsRef.current));
      setTaskRevision((revision) => revision + 1);
    }
  }, [showNotice]);

  const toggleTaskCompletion = useCallback(async (task: Task, completed: boolean) => {
    if (task.completed === completed || completingTaskIdsRef.current.has(task.id)) return;
    completingTaskIdsRef.current.add(task.id);
    setCompletingTaskIds(new Set(completingTaskIdsRef.current));
    mutationGenerationRef.current += 1;
    activeTaskMutationsRef.current += 1;
    setTasks((current) => current.map((item) => (
      item.id === task.id ? { ...item, completed } : item
    )));
    try {
      const persisted = await plannerApi.updateTask(task.id, { completed });
      setTasks((current) => current.map((item) => (
        item.id === task.id ? { ...item, completed: persisted.completed } : item
      )));
    } catch (error) {
      setTasks((current) => current.map((item) => (
        item.id === task.id ? { ...item, completed: task.completed } : item
      )));
      showNotice({ kind: "error", message: `The task completion could not be updated. ${errorMessage(error)}` });
    } finally {
      activeTaskMutationsRef.current = Math.max(0, activeTaskMutationsRef.current - 1);
      mutationGenerationRef.current += 1;
      completingTaskIdsRef.current.delete(task.id);
      setCompletingTaskIds(new Set(completingTaskIdsRef.current));
      setTaskRevision((revision) => revision + 1);
    }
  }, [showNotice]);

  const selectedEditorCalendar = calendarEditor?.mode === "edit"
    ? calendars.find((item) => item.id === calendarEditor.calendar.id) ?? calendarEditor.calendar
    : undefined;
  const selectedEditorExperiment = experimentEditor?.mode === "edit"
    ? experiments.find((item) => item.id === experimentEditor.experiment.id) ?? experimentEditor.experiment
    : undefined;
  const selectedEditorTask = taskEditor?.task
    ? tasks.find((item) => item.id === taskEditor.task?.id) ?? taskEditor.task
    : undefined;
  const workspaceLoading = calendarsLoading
    || migrationStatus === null
    || (!!selectedCalendarId && (experimentsLoading || tasksLoading));

  return (
    <div className="app-shell">
      <ExperimentSidebar
        calendars={calendars}
        calendarsLoading={calendarsLoading}
        experiments={experiments}
        loading={experimentsLoading}
        onArchiveCalendar={(calendar) => {
          void changeCalendarArchiveState(calendar, true).catch((error) => {
            showNotice({ kind: "error", message: `The calendar could not be archived. ${errorMessage(error)}` });
          });
        }}
        onCreate={openExperimentCreator}
        onCreateCalendar={openCalendarCreator}
        onDeleteCalendar={(calendar) => {
          if (calendar.archived) setCalendarToDelete(calendar);
        }}
        onEdit={(experiment) => {
          const scoped = experiments.find((item) => item.id === experiment.id);
          if (!scoped) return;
          setPendingTaskDate(null);
          setExperimentEditor({ mode: "edit", experiment: scoped });
        }}
        onEditCalendar={(calendar) => setCalendarEditor({ mode: "edit", calendar })}
        onSelect={setSelectedExperimentId}
        onSelectCalendar={selectCalendar}
        onUnarchiveCalendar={(calendar) => {
          void changeCalendarArchiveState(calendar, false).catch((error) => {
            showNotice({ kind: "error", message: `The calendar could not be unarchived. ${errorMessage(error)}` });
          });
        }}
        selectedCalendarId={selectedCalendarId}
        selectedExperimentId={selectedExperimentId}
      />
      <MonthCalendar
        completingTaskIds={completingTaskIds}
        experiments={experiments}
        hasCalendar={!!selectedCalendar}
        loading={workspaceLoading}
        month={month}
        movingTaskIds={movingTaskIds}
        onCreateCalendar={openCalendarCreator}
        onCreateExperiment={openExperimentCreator}
        onCreateTask={openTaskCreator}
        onEditTask={openTaskEditor}
        onMonthChange={changeMonth}
        onMoveTask={moveTask}
        onOpenDay={openExpandedDay}
        onToggleTaskCompletion={toggleTaskCompletion}
        selectedCalendarName={selectedCalendar?.name}
        selectedExperimentId={selectedExperimentId}
        tasks={visibleTasks}
      />

      {expandedDayDate ? (
        <DayView
          completingTaskIds={completingTaskIds}
          date={expandedDayDate}
          experiments={experiments}
          movingTaskIds={movingTaskIds}
          onClose={closeExpandedDay}
          onCreateTask={openTaskCreator}
          onEditTask={openTaskEditor}
          onToggleTaskCompletion={toggleTaskCompletion}
          tasks={visibleTasks}
        />
      ) : null}

      {notice ? (
        <div aria-live="polite" className={`app-notice app-notice--${notice.kind}`} role={notice.kind === "error" ? "alert" : "status"}>
          <span>{notice.message}</span>
          <button aria-label="Dismiss notification" onClick={() => setNotice(null)} type="button"><CloseIcon /></button>
        </div>
      ) : null}

      {calendarEditor ? (
        <CalendarEditor
          calendar={selectedEditorCalendar}
          onClose={() => {
            setCalendarEditor(null);
            setPendingTaskDate(null);
          }}
          onArchive={selectedEditorCalendar && !selectedEditorCalendar.archived
            ? () => changeCalendarArchiveState(selectedEditorCalendar, true)
            : undefined}
          onRequestDelete={selectedEditorCalendar?.archived ? () => {
            setCalendarEditor(null);
            setCalendarToDelete(selectedEditorCalendar);
          } : undefined}
          onSave={saveCalendar}
          onUnarchive={selectedEditorCalendar?.archived
            ? () => changeCalendarArchiveState(selectedEditorCalendar, false)
            : undefined}
        />
      ) : null}

      {experimentEditor ? (
        <ExperimentEditor
          experiment={selectedEditorExperiment}
          onClose={() => {
            setExperimentEditor(null);
            setPendingTaskDate(null);
          }}
          onArchive={selectedEditorExperiment && !selectedEditorExperiment.archived
            ? () => changeExperimentArchiveState(selectedEditorExperiment, true)
            : undefined}
          onRequestDelete={selectedEditorExperiment?.archived
            ? () => requestExperimentDelete(selectedEditorExperiment)
            : undefined}
          onSave={saveExperiment}
          onUnarchive={selectedEditorExperiment?.archived
            ? () => changeExperimentArchiveState(selectedEditorExperiment, false)
            : undefined}
        />
      ) : null}

      {taskEditor ? (
        <TaskEditor
          experiments={experiments}
          initialDate={taskEditor.date}
          initialExperimentId={taskEditor.initialExperimentId}
          onClose={() => setTaskEditor(null)}
          onRequestDelete={selectedEditorTask ? () => {
            setTaskEditor(null);
            setTaskToDelete(selectedEditorTask);
          } : undefined}
          onSave={saveTask}
          task={selectedEditorTask}
        />
      ) : null}

      {calendarToDelete ? (
        <ConfirmDialog
          confirmLabel="Delete calendar"
          detail={`This permanently deletes ${calendarToDelete.experimentCount} ${calendarToDelete.experimentCount === 1 ? "experiment" : "experiments"} and ${calendarToDelete.taskCount} ${calendarToDelete.taskCount === 1 ? "task" : "tasks"} in this calendar. Other calendars are not affected.`}
          message={`Delete “${calendarToDelete.name}”? This action cannot be undone.`}
          onClose={() => setCalendarToDelete(null)}
          onConfirm={deleteCalendar}
          title="Delete calendar"
        />
      ) : null}

      {experimentToDelete ? (
        <ConfirmDialog
          confirmLabel="Delete experiment"
          detail={experimentToDelete.taskCount > 0
            ? `${experimentToDelete.taskCount} associated ${experimentToDelete.taskCount === 1 ? "task" : "tasks"} will also be permanently deleted.`
            : "This experiment has no associated tasks."}
          message={`Delete “${experimentToDelete.name}”? This action cannot be undone.`}
          onClose={() => setExperimentToDelete(null)}
          onConfirm={deleteExperiment}
          title="Delete experiment"
        />
      ) : null}

      {taskToDelete ? (
        <ConfirmDialog
          confirmLabel="Delete task"
          message={`Delete “${taskToDelete.name}”? This action cannot be undone.`}
          onClose={() => setTaskToDelete(null)}
          onConfirm={deleteTask}
          title="Delete task"
        />
      ) : null}

      {migrationStatus?.required ? (
        <MigrationGate
          calendars={calendars}
          onCreateCalendar={createMigrationCalendar}
          onMigrate={migrateLegacyData}
          status={migrationStatus}
        />
      ) : null}
    </div>
  );
}
