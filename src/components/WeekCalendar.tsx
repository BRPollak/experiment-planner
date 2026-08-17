import { useMemo } from "react";
import type { Experiment, Task } from "../../shared/models";
import {
  getWeekRange,
  shiftWeek,
  toDateKey,
  WEEKDAYS,
  WEEKDAY_ORDER,
  weekHeading,
} from "../lib/dates";
import { CalendarToolbar, type CalendarView } from "./CalendarToolbar";
import { DayTaskGroups } from "./DayTaskGroups";
import { CalendarIcon, PlusIcon } from "./Icons";

export interface WeekCalendarBodyProps {
  date: Date;
  tasks: readonly Task[];
  experiments: readonly Experiment[];
  hasCalendar: boolean;
  completingTaskIds?: ReadonlySet<string>;
  movingTaskIds?: ReadonlySet<string>;
  loading: boolean;
  onCreateTask: (date: string) => void;
  onOpenDay: (date: string) => void;
  onCreateExperiment: () => void;
  onCreateCalendar: () => void;
  onEditTask: (task: Task) => void;
  onToggleTaskCompletion: (task: Task, completed: boolean) => void;
}

interface WeekCalendarProps extends WeekCalendarBodyProps {
  selectedExperimentId: string | null;
  selectedCalendarName?: string;
  view: CalendarView;
  onDateChange: (date: Date) => void;
  onViewChange: (view: CalendarView) => void;
}

export function WeekCalendar(props: WeekCalendarProps) {
  const {
    date,
    experiments,
    hasCalendar,
    onDateChange,
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
        heading={weekHeading(date)}
        nextLabel="Next week"
        onNext={() => onDateChange(shiftWeek(date, 1))}
        onPrevious={() => onDateChange(shiftWeek(date, -1))}
        onToday={() => onDateChange(new Date())}
        onViewChange={onViewChange}
        previousLabel="Previous week"
        selectedCalendarName={selectedCalendarName}
        selectedExperimentId={selectedExperimentId}
        view={view}
      />
      <WeekCalendarBody {...props} />
    </main>
  );
}

export function WeekCalendarBody({
  date,
  tasks,
  experiments,
  hasCalendar,
  completingTaskIds = new Set(),
  movingTaskIds = new Set(),
  loading,
  onCreateTask,
  onOpenDay,
  onCreateExperiment,
  onCreateCalendar,
  onEditTask,
  onToggleTaskCompletion,
}: WeekCalendarBodyProps) {
  const range = useMemo(() => getWeekRange(date), [date]);
  const tasksByDate = useMemo(() => {
    const grouped = new Map<string, Task[]>();
    tasks.forEach((task) => {
      const current = grouped.get(task.date) ?? [];
      current.push(task);
      grouped.set(task.date, current);
    });
    return grouped;
  }, [tasks]);
  const todayKey = toDateKey(new Date());

  return (
    <div aria-busy={loading} className="calendar-body week-calendar-body">
      {loading ? <div className="calendar-loading-bar" /> : null}
      <div
        aria-label="Scrollable week calendar"
        className="week-calendar-scroll"
        role="region"
        tabIndex={0}
      >
        <div aria-label={`${weekHeading(date)} week`} className="week-grid" role="grid">
          <div className="week-grid__row" role="row">
            {range.days.map((day, index) => {
              const dayTasks = tasksByDate.get(day.dateKey) ?? [];
              const weekday = WEEKDAYS[WEEKDAY_ORDER[index]];
              const isToday = day.dateKey === todayKey;
              const isWeekend = WEEKDAY_ORDER[index] === 0 || WEEKDAY_ORDER[index] === 6;
              const label = new Intl.DateTimeFormat(undefined, {
                weekday: "long",
                month: "long",
                day: "numeric",
                year: "numeric",
              }).format(day.date);

              return (
                <section
                  aria-label={`${label}. ${dayTasks.length} ${dayTasks.length === 1 ? "task" : "tasks"}.`}
                  className={`week-day ${isToday ? "is-today" : ""} ${isWeekend ? "is-weekend" : ""}`}
                  data-date-key={day.dateKey}
                  data-weekday={WEEKDAY_ORDER[index]}
                  key={day.dateKey}
                  role="gridcell"
                >
                  <header className="week-day__header">
                    <button
                      aria-current={isToday ? "date" : undefined}
                      aria-label={`Open ${label}`}
                      className="week-day__open"
                      onClick={() => onOpenDay(day.dateKey)}
                      type="button"
                    >
                      <span className="week-day__weekday">{weekday.slice(0, 3)}</span>
                      <time className="week-day__date" dateTime={day.dateKey}>
                        {day.date.getDate()}
                      </time>
                    </button>
                    <div className="week-day__actions">
                      {isToday ? <span className="today-label">Today</span> : null}
                      <button
                        aria-label={`Add task on ${label}`}
                        className="calendar-day__add-task week-day__add-task"
                        onClick={() => onCreateTask(day.dateKey)}
                        title="Add task"
                        type="button"
                      >
                        <PlusIcon />
                      </button>
                    </div>
                  </header>

                  <div className="week-day__tasks">
                    {dayTasks.length > 0 ? (
                      <DayTaskGroups
                        completingTaskIds={completingTaskIds}
                        experiments={experiments}
                        movingTaskIds={movingTaskIds}
                        onEditTask={onEditTask}
                        onToggleTaskCompletion={onToggleTaskCompletion}
                        tasks={dayTasks}
                      />
                    ) : (
                      <p className="week-day__empty">No tasks</p>
                    )}
                  </div>
                </section>
              );
            })}
          </div>
        </div>
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
