import {
  useMemo,
  useRef,
  useState,
  type CSSProperties,
  type DragEvent,
  type KeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import type { Experiment, Task } from "../../shared/models";
import { getCalendarRange, monthHeading, shiftMonth, toDateKey, WEEKDAYS } from "../lib/dates";
import { formatTaskTime, sortTasks } from "../lib/tasks";
import { CalendarIcon, ChevronLeftIcon, ChevronRightIcon, NotesIcon, PlusIcon } from "./Icons";

interface MonthCalendarProps {
  month: Date;
  tasks: Task[];
  experiments: Experiment[];
  selectedExperimentId: string | null;
  selectedCalendarName?: string;
  hasCalendar: boolean;
  movingTaskIds: ReadonlySet<string>;
  loading: boolean;
  onMonthChange: (month: Date) => void;
  onCreateTask: (date: string) => void;
  onOpenDay: (date: string) => void;
  onCreateExperiment: () => void;
  onCreateCalendar: () => void;
  onEditTask: (task: Task) => void;
  onMoveTask: (task: Task, date: string) => void;
}

export function MonthCalendar({
  month,
  tasks,
  experiments,
  selectedExperimentId,
  selectedCalendarName,
  hasCalendar,
  movingTaskIds,
  loading,
  onMonthChange,
  onCreateTask,
  onOpenDay,
  onCreateExperiment,
  onCreateCalendar,
  onEditTask,
  onMoveTask,
}: MonthCalendarProps) {
  const range = useMemo(() => getCalendarRange(month), [month]);
  const todayKey = toDateKey(new Date());
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const dayRefs = useRef(new Map<string, HTMLDivElement>());

  const experimentById = useMemo(
    () => new Map(experiments.map((experiment) => [experiment.id, experiment])),
    [experiments],
  );
  const tasksByDate = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    tasks.forEach((task) => {
      const current = grouped.get(task.date) ?? [];
      current.push(task);
      grouped.set(task.date, current);
    });
    grouped.forEach((dayTasks, date) => {
      grouped.set(date, sortTasks(dayTasks));
    });
    return grouped;
  }, [tasks]);

  const selectedExperiment = selectedExperimentId
    ? experimentById.get(selectedExperimentId)
    : undefined;
  const isCurrentMonth = new Date().getFullYear() === month.getFullYear()
    && new Date().getMonth() === month.getMonth();
  const suggestedTaskDate = isCurrentMonth
    ? todayKey
    : toDateKey(new Date(month.getFullYear(), month.getMonth(), 1));

  const handleDayKeyDown = (
    event: KeyboardEvent<HTMLDivElement>,
    date: string,
    visualIndex: number,
  ) => {
    if (event.target !== event.currentTarget) return;
    if (event.key === "Enter" || event.key === " ") {
      event.preventDefault();
      onOpenDay(date);
      return;
    }

    const offset = {
      ArrowLeft: -1,
      ArrowRight: 1,
      ArrowUp: -7,
      ArrowDown: 7,
    }[event.key];
    if (offset === undefined) return;

    const nextDay = range.days[visualIndex + offset];
    if (!nextDay) return;
    event.preventDefault();
    dayRefs.current.get(nextDay.dateKey)?.focus();
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>, date: string) => {
    event.preventDefault();
    const id = event.dataTransfer.getData("text/plain") || draggedTaskId;
    const task = tasks.find((candidate) => candidate.id === id);
    setDragOverDate(null);
    setDraggedTaskId(null);
    if (task && task.date !== date) onMoveTask(task, date);
  };

  const handleDayClick = (event: ReactMouseEvent<HTMLDivElement>, date: string) => {
    const target = event.target as Element;
    if (
      typeof target.closest === "function"
      && target.closest(
        "button, a, input, select, textarea, [role='button'], [contenteditable='true']",
      )
    ) {
      return;
    }
    onOpenDay(date);
  };

  return (
    <main className="calendar-shell">
      <header className="calendar-toolbar">
        <div className="calendar-toolbar__title">
          <h2>{monthHeading(month)}</h2>
          <div className="calendar-toolbar__scope">
            {selectedExperiment ? <span className="scope-dot" style={{ backgroundColor: selectedExperiment.color }} /> : null}
            <span>{hasCalendar ? `${selectedCalendarName ?? "Calendar"} · ${selectedExperiment?.name ?? "All experiments"}` : "No calendar selected"}</span>
          </div>
        </div>

        <div aria-label="Calendar navigation" className="calendar-navigation">
          <button aria-label="Previous month" className="icon-button toolbar-icon-button" onClick={() => onMonthChange(shiftMonth(month, -1))} title="Previous month" type="button">
            <ChevronLeftIcon />
          </button>
          <button className="button button--secondary today-button" onClick={() => onMonthChange(new Date())} type="button">Today</button>
          <button aria-label="Next month" className="icon-button toolbar-icon-button" onClick={() => onMonthChange(shiftMonth(month, 1))} title="Next month" type="button">
            <ChevronRightIcon />
          </button>
        </div>

        <button className="button button--primary add-task-button" onClick={() => onCreateTask(suggestedTaskDate)} type="button">
          <PlusIcon /> Add Task
        </button>
      </header>

      <div aria-busy={loading} className="calendar-body">
        {loading ? <div className="calendar-loading-bar" /> : null}
        <div className="weekday-header" role="row">
          {WEEKDAYS.map((weekday) => <div key={weekday} role="columnheader">{weekday}</div>)}
        </div>
        <div
          className="calendar-grid"
          role="grid"
          style={{ "--week-count": range.weekCount } as CSSProperties}
        >
          {range.days.map((day, visualIndex) => {
            const dayTasks = tasksByDate.get(day.dateKey) ?? [];
            const isToday = day.dateKey === todayKey;
            const isDropTarget = dragOverDate === day.dateKey;
            const isWeekend = day.date.getDay() === 0 || day.date.getDay() === 6;
            const label = new Intl.DateTimeFormat(undefined, {
              weekday: "long",
              month: "long",
              day: "numeric",
              year: "numeric",
            }).format(day.date);

            return (
              <div
                aria-label={`${label}. ${dayTasks.length} ${dayTasks.length === 1 ? "task" : "tasks"}. Open day details.`}
                className={`calendar-day ${day.isCurrentMonth ? "" : "is-outside-month"} ${isToday ? "is-today" : ""} ${isWeekend ? "is-weekend" : ""} ${isDropTarget ? "is-drop-target" : ""}`}
                data-date-key={day.dateKey}
                data-weekday={day.date.getDay()}
                key={day.dateKey}
                onClick={(event) => handleDayClick(event, day.dateKey)}
                onDragEnter={(event) => {
                  if (draggedTaskId) {
                    event.preventDefault();
                    setDragOverDate(day.dateKey);
                  }
                }}
                onDragOver={(event) => {
                  if (draggedTaskId) {
                    event.preventDefault();
                    event.dataTransfer.dropEffect = "move";
                  }
                }}
                onDrop={(event) => handleDrop(event, day.dateKey)}
                onKeyDown={(event) => handleDayKeyDown(event, day.dateKey, visualIndex)}
                ref={(element) => {
                  if (element) dayRefs.current.set(day.dateKey, element);
                  else dayRefs.current.delete(day.dateKey);
                }}
                role="gridcell"
                tabIndex={0}
              >
                <div className="calendar-day__header">
                  <button
                    aria-current={isToday ? "date" : undefined}
                    aria-label={`Open ${label}`}
                    className="day-number"
                    onClick={(event) => {
                      event.stopPropagation();
                      onOpenDay(day.dateKey);
                    }}
                    type="button"
                  >
                    {day.date.getDate()}
                  </button>
                  <div className="calendar-day__header-actions">
                    {isToday ? <span className="today-label">Today</span> : null}
                    <button
                      aria-label={`Add task on ${label}`}
                      className="calendar-day__add-task"
                      onClick={(event) => {
                        event.stopPropagation();
                        onCreateTask(day.dateKey);
                      }}
                      title="Add task"
                      type="button"
                    >
                      <PlusIcon />
                    </button>
                  </div>
                </div>
                <div className="task-list">
                  {dayTasks.map((task) => {
                    const experiment = experimentById.get(task.experimentId);
                    const isMoving = movingTaskIds.has(task.id);
                    const displayTime = formatTaskTime(task.time);
                    const taskStyle = {
                      "--task-color": experiment?.color ?? "#64748b",
                    } as CSSProperties;
                    return (
                      <button
                        aria-label={`${displayTime ? `${displayTime}, ` : ""}${task.name}, ${experiment?.name ?? "experiment"}${task.notes ? ", has notes" : ""}.${isMoving ? " Saving new date." : " Drag to reschedule or select to edit."}`}
                        className={`calendar-task ${draggedTaskId === task.id ? "is-dragging" : ""} ${isMoving ? "is-saving" : ""}`}
                        disabled={isMoving}
                        draggable={!isMoving}
                        key={task.id}
                        onClick={(event) => {
                          event.stopPropagation();
                          onEditTask(task);
                        }}
                        onDragEnd={(event) => {
                          event.stopPropagation();
                          setDraggedTaskId(null);
                          setDragOverDate(null);
                        }}
                        onDragStart={(event) => {
                          if (isMoving) {
                            event.preventDefault();
                            return;
                          }
                          event.stopPropagation();
                          setDraggedTaskId(task.id);
                          event.dataTransfer.effectAllowed = "move";
                          event.dataTransfer.setData("text/plain", task.id);
                        }}
                        style={taskStyle}
                        title={`${displayTime ? `${displayTime} · ` : ""}${task.name} · ${experiment?.name ?? "Unknown experiment"}`}
                        type="button"
                      >
                        <span className="calendar-task__color" />
                        {displayTime ? <time className="calendar-task__time" dateTime={task.time ?? undefined}>{displayTime}</time> : null}
                        <span className="calendar-task__name">{task.name}</span>
                        {task.notes ? <NotesIcon className="calendar-task__notes" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>

        {!loading && !hasCalendar ? (
          <div className="calendar-empty-state">
            <span className="empty-state-icon"><CalendarIcon /></span>
            <h3>No calendars yet — create your first calendar.</h3>
            <p>Calendars keep separate groups of experiments in focused workspaces.</p>
            <button className="button button--primary" onClick={onCreateCalendar} type="button">
              <PlusIcon /> Create calendar
            </button>
          </div>
        ) : !loading && experiments.length === 0 ? (
          <div className="calendar-empty-state">
            <span className="empty-state-icon"><CalendarIcon /></span>
            <h3>No experiments yet — create your first experiment.</h3>
            <p>Experiments organize and color-code every task on the calendar.</p>
            <button className="button button--primary" onClick={onCreateExperiment} type="button">
              <PlusIcon /> Create experiment
            </button>
          </div>
        ) : null}
      </div>
    </main>
  );
}
