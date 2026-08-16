import { useMemo, type CSSProperties } from "react";
import type { Experiment, Task } from "../../shared/models";
import { friendlyDate } from "../lib/dates";
import { formatTaskTime, groupTasksByExperiment } from "../lib/tasks";
import { CalendarIcon, CheckIcon, PlusIcon } from "./Icons";
import { Modal } from "./Modal";

interface DayViewProps {
  date: string;
  experiments: readonly Experiment[];
  completingTaskIds?: ReadonlySet<string>;
  movingTaskIds?: ReadonlySet<string>;
  tasks: readonly Task[];
  onClose: () => void;
  onCreateTask: (date: string) => void;
  onEditTask: (task: Task) => void;
  onToggleTaskCompletion: (task: Task, completed: boolean) => void;
}

const FALLBACK_EXPERIMENT_COLOR = "#64748b";

export function DayView({
  date,
  experiments,
  completingTaskIds = new Set(),
  movingTaskIds = new Set(),
  tasks,
  onClose,
  onCreateTask,
  onEditTask,
  onToggleTaskCompletion,
}: DayViewProps) {
  const groups = useMemo(
    () => groupTasksByExperiment(tasks.filter((task) => task.date === date), experiments),
    [date, experiments, tasks],
  );

  const taskCount = groups.reduce((count, group) => count + group.tasks.length, 0);

  const createTask = () => {
    onClose();
    onCreateTask(date);
  };

  const editTask = (task: Task) => {
    onClose();
    onEditTask(task);
  };

  return (
    <Modal
      onClose={onClose}
      size="xlarge"
      subtitle={`${taskCount} visible ${taskCount === 1 ? "task" : "tasks"}`}
      title={friendlyDate(date)}
    >
      <div className="modal__body day-view">
        {groups.length > 0 ? (
          <>
            <div className="day-view__toolbar">
              <p>Tasks are grouped by experiment in scheduled order.</p>
              <button className="button button--primary" onClick={createTask} type="button">
                <PlusIcon /> Add task
              </button>
            </div>

            <div className="day-view__groups">
              {groups.map((group) => {
                const experiment = group.experiment;
                const experimentName = experiment?.name ?? "No experiment";
                const groupStyle = {
                  "--experiment-color": experiment?.color ?? FALLBACK_EXPERIMENT_COLOR,
                } as CSSProperties;

                return (
                  <section
                    aria-label={`${experimentName} tasks`}
                    className="day-view__group"
                    key={group.experimentId ?? "no-experiment"}
                    style={groupStyle}
                  >
                    <header className="day-view__group-header">
                      <span aria-hidden="true" className="day-view__experiment-color" />
                      <h3>{experimentName}</h3>
                      <span className="day-view__group-count">
                        {group.tasks.length} {group.tasks.length === 1 ? "task" : "tasks"}
                      </span>
                    </header>
                    <ul className="day-view__task-list">
                      {group.tasks.map((task) => {
                        const displayTime = formatTaskTime(task.time);
                        const notes = task.notes?.trim();
                        const notesId = notes ? `day-view-task-notes-${task.id}` : undefined;
                        const isMoving = movingTaskIds.has(task.id);
                        const isCompleting = completingTaskIds.has(task.id);
                        const isSaving = isMoving || isCompleting;
                        return (
                          <li className="day-view__task-row" key={task.id}>
                            <button
                              aria-describedby={notesId}
                              aria-label={isMoving
                                ? `${task.name} is saving its new date`
                                : isCompleting
                                  ? `${task.name} is saving its completion status`
                                : `Edit ${task.name}${displayTime ? ` at ${displayTime}` : ""}`}
                              className={`day-view__task ${task.completed ? "is-completed" : ""} ${isSaving ? "is-saving" : ""}`}
                              disabled={isSaving}
                              onClick={() => editTask(task)}
                              type="button"
                            >
                              <span className="day-view__task-heading">
                                <span className="day-view__task-name">{task.name}</span>
                                {displayTime ? (
                                  <time className="day-view__task-time" dateTime={task.time ?? undefined}>
                                    {displayTime}
                                  </time>
                                ) : null}
                              </span>
                              {notes ? <span className="day-view__task-notes" id={notesId}>{notes}</span> : null}
                            </button>
                            <button
                              aria-checked={task.completed}
                              aria-label={`Mark ${task.name} ${task.completed ? "incomplete" : "complete"}`}
                              className={`day-view__task-checkbox ${isCompleting ? "is-saving" : ""}`}
                              disabled={isSaving}
                              onClick={() => onToggleTaskCompletion(task, !task.completed)}
                              role="checkbox"
                              title={task.completed ? "Mark incomplete" : "Mark complete"}
                              type="button"
                            >
                              <CheckIcon />
                            </button>
                          </li>
                        );
                      })}
                    </ul>
                  </section>
                );
              })}
            </div>
          </>
        ) : (
          <div className="day-view__empty">
            <span aria-hidden="true" className="day-view__empty-icon"><CalendarIcon /></span>
            <h3>No visible tasks for this day</h3>
            <p>Add a task for this date, or change the active experiment filter to see other work.</p>
            <button className="button button--primary" onClick={createTask} type="button">
              <PlusIcon /> Add task
            </button>
          </div>
        )}
      </div>
    </Modal>
  );
}
