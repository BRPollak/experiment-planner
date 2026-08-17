import { useMemo } from "react";
import type { Experiment, Task } from "../../shared/models";
import { friendlyDate } from "../lib/dates";
import { DayTaskGroups } from "./DayTaskGroups";
import { CalendarIcon, PlusIcon } from "./Icons";
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
  const dayTasks = useMemo(
    () => tasks.filter((task) => task.date === date),
    [date, tasks],
  );
  const taskCount = dayTasks.length;

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
        {dayTasks.length > 0 ? (
          <>
            <div className="day-view__toolbar">
              <p>Tasks are grouped by experiment in scheduled order.</p>
              <button className="button button--primary" onClick={createTask} type="button">
                <PlusIcon /> Add task
              </button>
            </div>

            <DayTaskGroups
              completingTaskIds={completingTaskIds}
              experiments={experiments}
              movingTaskIds={movingTaskIds}
              onEditTask={editTask}
              onToggleTaskCompletion={onToggleTaskCompletion}
              tasks={dayTasks}
            />
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
