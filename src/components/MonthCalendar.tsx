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
import {
  getCalendarRange,
  monthHeading,
  shiftMonth,
  toDateKey,
  WEEKDAYS,
  WEEKDAY_ORDER,
} from "../lib/dates";
import { formatTaskTime, sortCalendarTasks } from "../lib/tasks";
import { CalendarToolbar, type CalendarView } from "./CalendarToolbar";
import { CalendarIcon, CheckIcon, NotesIcon, PlusIcon } from "./Icons";

export interface MonthCalendarBodyProps {
  month: Date;
  tasks: Task[];
  experiments: Experiment[];
  hasCalendar: boolean;
  completingTaskIds?: ReadonlySet<string>;
  movingTaskIds: ReadonlySet<string>;
  loading: boolean;
  onCreateTask: (date: string) => void;
  onOpenDay: (date: string) => void;
  onCreateExperiment: () => void;
  onCreateCalendar: () => void;
  onEditTask: (task: Task) => void;
  onMoveTask: (task: Task, date: string) => void;
  onToggleTaskCompletion: (task: Task, completed: boolean) => void;
}

interface MonthCalendarProps extends MonthCalendarBodyProps {
  selectedExperimentId: string | null;
  selectedCalendarName?: string;
  view: CalendarView;
  onMonthChange: (month: Date) => void;
  onViewChange: (view: CalendarView) => void;
}

export function MonthCalendar(props: MonthCalendarProps) {
  const {
    experiments,
    hasCalendar,
    month,
    onMonthChange,
    onViewChange,
    selectedCalendarName,
    selectedExperimentId,
    view,
  } = props;

  return (
    <main className="calendar-shell">
      <CalendarToolbar
        experiments={experiments}
        hasCalendar={hasCalendar}
        heading={monthHeading(month)}
        nextLabel="Next month"
        onNext={() => onMonthChange(shiftMonth(month, 1))}
        onPrevious={() => onMonthChange(shiftMonth(month, -1))}
        onToday={() => onMonthChange(new Date())}
        onViewChange={onViewChange}
        previousLabel="Previous month"
        selectedCalendarName={selectedCalendarName}
        selectedExperimentId={selectedExperimentId}
        view={view}
      />
      <MonthCalendarBody {...props} />
    </main>
  );
}

export function MonthCalendarBody({
  month,
  tasks,
  experiments,
  hasCalendar,
  completingTaskIds = new Set(),
  movingTaskIds,
  loading,
  onCreateTask,
  onOpenDay,
  onCreateExperiment,
  onCreateCalendar,
  onEditTask,
  onMoveTask,
  onToggleTaskCompletion,
}: MonthCalendarBodyProps) {
  const range = useMemo(() => getCalendarRange(month), [month]);
  const todayKey = toDateKey(new Date());
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverDate, setDragOverDate] = useState<string | null>(null);
  const [focusedDateKey, setFocusedDateKey] = useState<string | null>(null);
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
      grouped.set(date, sortCalendarTasks(dayTasks));
    });
    return grouped;
  }, [tasks]);

  const isCurrentMonth = new Date().getFullYear() === month.getFullYear()
    && new Date().getMonth() === month.getMonth();
  const focusedDateIsVisible = focusedDateKey
    ? range.days.some((day) => day.dateKey === focusedDateKey)
    : false;
  const gridTabStopDate = focusedDateIsVisible
    ? focusedDateKey
    : isCurrentMonth
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

    let offset: number;
    switch (event.key) {
      case "ArrowLeft":
        offset = -1;
        break;
      case "ArrowRight":
        offset = 1;
        break;
      case "ArrowUp":
        offset = -7;
        break;
      case "ArrowDown":
        offset = 7;
        break;
      default:
        return;
    }
    event.preventDefault();

    const nextDay = range.days[visualIndex + offset];
    if (!nextDay) return;
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
    <div aria-busy={loading} className="calendar-body">
        {loading ? <div className="calendar-loading-bar" /> : null}
        <div className="weekday-header" role="row">
          {WEEKDAYS.map((weekday, index) => (
            <div data-weekday={WEEKDAY_ORDER[index]} key={weekday} role="columnheader">
              {weekday}
            </div>
          ))}
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
            const isGridTabStop = day.dateKey === gridTabStopDate;
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
                onFocus={() => setFocusedDateKey(day.dateKey)}
                onKeyDown={(event) => handleDayKeyDown(event, day.dateKey, visualIndex)}
                ref={(element) => {
                  if (element) dayRefs.current.set(day.dateKey, element);
                  else dayRefs.current.delete(day.dateKey);
                }}
                role="gridcell"
                tabIndex={isGridTabStop ? 0 : -1}
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
                    tabIndex={isGridTabStop ? 0 : -1}
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
                      tabIndex={isGridTabStop ? 0 : -1}
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
                    const isCompleting = completingTaskIds.has(task.id);
                    const isSaving = isMoving || isCompleting;
                    const displayTime = formatTaskTime(task.time);
                    const taskStyle = {
                      "--task-color": experiment?.color ?? "#64748b",
                    } as CSSProperties;
                    return (
                      <div
                        className={`calendar-task-row ${draggedTaskId === task.id ? "is-dragging" : ""}`}
                        key={task.id}
                      >
                        <button
                          aria-label={`${displayTime ? `${displayTime}, ` : ""}${task.name}, ${experiment?.name ?? "experiment"}${task.notes ? ", has notes" : ""}.${task.completed ? " Completed." : ""}${isMoving ? " Saving new date." : isCompleting ? " Saving completion status." : " Drag to reschedule or select to edit."}`}
                          className={`calendar-task ${task.completed ? "is-completed" : ""} ${draggedTaskId === task.id ? "is-dragging" : ""} ${isSaving ? "is-saving" : ""}`}
                          disabled={isSaving}
                          draggable={!isSaving}
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
                            if (isSaving) {
                              event.preventDefault();
                              return;
                            }
                            event.stopPropagation();
                            setDraggedTaskId(task.id);
                            event.dataTransfer.effectAllowed = "move";
                            event.dataTransfer.setData("text/plain", task.id);
                          }}
                          style={taskStyle}
                          tabIndex={isGridTabStop ? 0 : -1}
                          title={`${task.completed ? "Completed · " : ""}${displayTime ? `${displayTime} · ` : ""}${task.name} · ${experiment?.name ?? "Unknown experiment"}`}
                          type="button"
                        >
                          <span className="calendar-task__color" />
                          {displayTime ? <time className="calendar-task__time" dateTime={task.time ?? undefined}>{displayTime}</time> : null}
                          <span className="calendar-task__name">{task.name}</span>
                          {task.notes ? <NotesIcon className="calendar-task__notes" /> : null}
                        </button>
                        <button
                          aria-checked={task.completed}
                          aria-label={`Mark ${task.name} ${task.completed ? "incomplete" : "complete"}`}
                          className={`calendar-task__checkbox ${isCompleting ? "is-saving" : ""}`}
                          disabled={isSaving}
                          onClick={(event) => {
                            event.stopPropagation();
                            onToggleTaskCompletion(task, !task.completed);
                          }}
                          role="checkbox"
                          tabIndex={isGridTabStop ? 0 : -1}
                          title={task.completed ? "Mark incomplete" : "Mark complete"}
                          type="button"
                        >
                          <CheckIcon />
                        </button>
                      </div>
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
  );
}
