import type { Experiment } from "../../shared/models";
import { ChevronLeftIcon, ChevronRightIcon } from "./Icons";

export type CalendarView = "month" | "week";

interface CalendarToolbarProps {
  experiments: readonly Experiment[];
  hasCalendar: boolean;
  heading: string;
  nextLabel: string;
  previousLabel: string;
  selectedCalendarName?: string;
  selectedExperimentId: string | null;
  view: CalendarView;
  onNext: () => void;
  onPrevious: () => void;
  onToday: () => void;
  onViewChange: (view: CalendarView) => void;
}

export function CalendarToolbar({
  experiments,
  hasCalendar,
  heading,
  nextLabel,
  previousLabel,
  selectedCalendarName,
  selectedExperimentId,
  view,
  onNext,
  onPrevious,
  onToday,
  onViewChange,
}: CalendarToolbarProps) {
  const selectedExperiment = selectedExperimentId
    ? experiments.find((experiment) => experiment.id === selectedExperimentId)
    : undefined;

  return (
    <header className="calendar-toolbar">
      <div className="calendar-toolbar__title">
        <h2>{heading}</h2>
        <div className="calendar-toolbar__scope">
          {selectedExperiment ? (
            <span
              aria-hidden="true"
              className="scope-dot"
              style={{ backgroundColor: selectedExperiment.color }}
            />
          ) : null}
          <span>
            {hasCalendar
              ? `${selectedCalendarName ?? "Calendar"} · ${selectedExperiment?.name ?? "All experiments"}`
              : "No calendar selected"}
          </span>
        </div>
      </div>

      <div aria-label="Calendar navigation" className="calendar-navigation">
        <button
          aria-label={previousLabel}
          className="icon-button toolbar-icon-button"
          onClick={onPrevious}
          title={previousLabel}
          type="button"
        >
          <ChevronLeftIcon />
        </button>
        <button
          className="button button--secondary today-button"
          onClick={onToday}
          type="button"
        >
          Today
        </button>
        <button
          aria-label={nextLabel}
          className="icon-button toolbar-icon-button"
          onClick={onNext}
          title={nextLabel}
          type="button"
        >
          <ChevronRightIcon />
        </button>
      </div>

      <div
        aria-label="Calendar view"
        className="calendar-view-switcher"
        data-view={view}
        role="group"
      >
        {(["month", "week"] as const).map((option) => (
          <button
            aria-pressed={view === option}
            className={`calendar-view-switcher__option ${view === option ? "is-active" : ""}`}
            key={option}
            onClick={() => onViewChange(option)}
            type="button"
          >
            {option === "month" ? "Month" : "Week"}
          </button>
        ))}
      </div>
    </header>
  );
}
