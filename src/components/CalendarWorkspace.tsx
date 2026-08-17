import type { Experiment, Task } from "../../shared/models";
import { monthHeading, shiftMonth, shiftWeek, weekHeading } from "../lib/dates";
import { CalendarToolbar, type CalendarView } from "./CalendarToolbar";
import { MonthCalendarBody } from "./MonthCalendar";
import { WeekCalendarBody } from "./WeekCalendar";

interface CalendarWorkspaceProps {
  date: Date;
  tasks: Task[];
  experiments: Experiment[];
  selectedExperimentId: string | null;
  selectedCalendarName?: string;
  hasCalendar: boolean;
  completingTaskIds?: ReadonlySet<string>;
  movingTaskIds: ReadonlySet<string>;
  loading: boolean;
  view: CalendarView;
  onDateChange: (date: Date) => void;
  onCreateTask: (date: string) => void;
  onOpenDay: (date: string) => void;
  onCreateExperiment: () => void;
  onCreateCalendar: () => void;
  onEditTask: (task: Task) => void;
  onMoveTask: (task: Task, date: string) => void;
  onToggleTaskCompletion: (task: Task, completed: boolean) => void;
  onViewChange: (view: CalendarView) => void;
}

export function CalendarWorkspace({
  date,
  tasks,
  experiments,
  selectedExperimentId,
  selectedCalendarName,
  hasCalendar,
  completingTaskIds = new Set(),
  movingTaskIds,
  loading,
  view,
  onDateChange,
  onCreateTask,
  onOpenDay,
  onCreateExperiment,
  onCreateCalendar,
  onEditTask,
  onMoveTask,
  onToggleTaskCompletion,
  onViewChange,
}: CalendarWorkspaceProps) {
  const isMonthView = view === "month";

  return (
    <main className="calendar-shell">
      <CalendarToolbar
        experiments={experiments}
        hasCalendar={hasCalendar}
        heading={isMonthView ? monthHeading(date) : weekHeading(date)}
        nextLabel={isMonthView ? "Next month" : "Next week"}
        onNext={() => onDateChange(isMonthView ? shiftMonth(date, 1) : shiftWeek(date, 1))}
        onPrevious={() => onDateChange(isMonthView ? shiftMonth(date, -1) : shiftWeek(date, -1))}
        onToday={() => onDateChange(new Date())}
        onViewChange={onViewChange}
        previousLabel={isMonthView ? "Previous month" : "Previous week"}
        selectedCalendarName={selectedCalendarName}
        selectedExperimentId={selectedExperimentId}
        view={view}
      />

      {isMonthView ? (
        <MonthCalendarBody
          completingTaskIds={completingTaskIds}
          experiments={experiments}
          hasCalendar={hasCalendar}
          loading={loading}
          month={date}
          movingTaskIds={movingTaskIds}
          onCreateCalendar={onCreateCalendar}
          onCreateExperiment={onCreateExperiment}
          onCreateTask={onCreateTask}
          onEditTask={onEditTask}
          onMoveTask={onMoveTask}
          onOpenDay={onOpenDay}
          onToggleTaskCompletion={onToggleTaskCompletion}
          tasks={tasks}
        />
      ) : (
        <WeekCalendarBody
          completingTaskIds={completingTaskIds}
          date={date}
          experiments={experiments}
          hasCalendar={hasCalendar}
          loading={loading}
          movingTaskIds={movingTaskIds}
          onCreateCalendar={onCreateCalendar}
          onCreateExperiment={onCreateExperiment}
          onCreateTask={onCreateTask}
          onEditTask={onEditTask}
          onOpenDay={onOpenDay}
          onToggleTaskCompletion={onToggleTaskCompletion}
          tasks={tasks}
        />
      )}
    </main>
  );
}
