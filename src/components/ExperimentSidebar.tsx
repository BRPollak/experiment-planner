import type { Experiment } from "../../shared/models";
import type { PlannerCalendar } from "../lib/types";
import {
  ArchiveIcon,
  CalendarIcon,
  FlaskIcon,
  PencilIcon,
  PlusIcon,
  RestoreIcon,
  TrashIcon,
} from "./Icons";

interface ExperimentSidebarProps {
  experiments: Experiment[];
  calendars: PlannerCalendar[];
  selectedCalendarId: string | null;
  selectedExperimentId: string | null;
  loading: boolean;
  calendarsLoading: boolean;
  onSelect: (id: string | null) => void;
  onCreate: () => void;
  onEdit: (experiment: Experiment) => void;
  onSelectCalendar: (id: string) => void;
  onCreateCalendar: () => void;
  onEditCalendar: (calendar: PlannerCalendar) => void;
  onArchiveCalendar: (calendar: PlannerCalendar) => void;
  onUnarchiveCalendar: (calendar: PlannerCalendar) => void;
  onDeleteCalendar: (calendar: PlannerCalendar) => void;
}

function taskCountLabel(count: number) {
  return `${count} ${count === 1 ? "task" : "tasks"}`;
}

export function ExperimentSidebar({
  experiments,
  calendars,
  selectedCalendarId,
  selectedExperimentId,
  loading,
  calendarsLoading,
  onSelect,
  onCreate,
  onEdit,
  onSelectCalendar,
  onCreateCalendar,
  onEditCalendar,
  onArchiveCalendar,
  onUnarchiveCalendar,
  onDeleteCalendar,
}: ExperimentSidebarProps) {
  const totalTasks = experiments.reduce((sum, experiment) => sum + experiment.taskCount, 0);
  const selectedCalendar = calendars.find((calendar) => calendar.id === selectedCalendarId);
  const activeCalendars = calendars.filter((calendar) => !calendar.archived);
  const archivedCalendars = calendars.filter((calendar) => calendar.archived);
  const activeExperiments = experiments.filter((experiment) => !experiment.archived);
  const archivedExperiments = experiments.filter((experiment) => experiment.archived);

  const renderExperiment = (experiment: Experiment) => (
    <div
      className={`experiment-filter-wrap ${experiment.archived ? "is-archived" : ""} ${selectedExperimentId === experiment.id ? "is-selected" : ""}`}
      key={experiment.id}
    >
      <button
        aria-current={selectedExperimentId === experiment.id ? "page" : undefined}
        className="experiment-filter"
        onClick={() => onSelect(experiment.id)}
        title={experiment.description ?? experiment.name}
        type="button"
      >
        <span className="experiment-dot" style={{ backgroundColor: experiment.color }} />
        <span className="experiment-filter__content">
          <span className="experiment-filter__name">{experiment.name}</span>
          <span className="experiment-filter__count">{taskCountLabel(experiment.taskCount)}</span>
        </span>
      </button>
      <button
        aria-label={`Edit ${experiment.name}`}
        className="experiment-edit-button"
        onClick={() => onEdit(experiment)}
        title={`Edit ${experiment.name}`}
        type="button"
      >
        <PencilIcon />
      </button>
    </div>
  );

  return (
    <aside className="sidebar">
      <div className="sidebar__brand">
        <span className="brand-mark"><FlaskIcon /></span>
        <div>
          <h1>Experiment Planner</h1>
          <p>Calendar workspace</p>
        </div>
      </div>

      <section aria-labelledby="calendar-workspace-label" className="workspace-switcher">
        <div className="workspace-switcher__heading">
          <span id="calendar-workspace-label">Calendar</span>
          <button aria-label="Create calendar" className="icon-button icon-button--accent" disabled={calendarsLoading} onClick={onCreateCalendar} title="Create calendar" type="button">
            <PlusIcon />
          </button>
        </div>
        {calendarsLoading ? (
          <div aria-label="Loading calendars" className="workspace-switcher__skeleton" />
        ) : selectedCalendar ? (
          <>
            <div className={`workspace-switcher__row ${selectedCalendar.archived ? "is-archived" : ""}`}>
              <span className="workspace-select-icon"><CalendarIcon /></span>
              <select
                aria-label="Selected calendar"
                className={`workspace-select ${selectedCalendar.archived ? "is-archived" : ""}`}
                onChange={(event) => onSelectCalendar(event.target.value)}
                value={selectedCalendar.id}
              >
                {activeCalendars.length ? (
                  <optgroup label="Active calendars">
                    {activeCalendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}
                  </optgroup>
                ) : null}
                {archivedCalendars.length ? (
                  <optgroup label="Archived calendars">
                    {archivedCalendars.map((calendar) => <option key={calendar.id} value={calendar.id}>{calendar.name}</option>)}
                  </optgroup>
                ) : null}
              </select>
              <button aria-label={`Rename ${selectedCalendar.name}`} className="workspace-action" onClick={() => onEditCalendar(selectedCalendar)} title="Rename calendar" type="button">
                <PencilIcon />
              </button>
              {selectedCalendar.archived ? (
                <>
                  <button aria-label={`Unarchive ${selectedCalendar.name}`} className="workspace-action" onClick={() => onUnarchiveCalendar(selectedCalendar)} title="Unarchive calendar" type="button">
                    <RestoreIcon />
                  </button>
                  <button aria-label={`Delete ${selectedCalendar.name}`} className="workspace-action workspace-action--danger" onClick={() => onDeleteCalendar(selectedCalendar)} title="Delete calendar" type="button">
                    <TrashIcon />
                  </button>
                </>
              ) : (
                <button aria-label={`Archive ${selectedCalendar.name}`} className="workspace-action" onClick={() => onArchiveCalendar(selectedCalendar)} title="Archive calendar" type="button">
                  <ArchiveIcon />
                </button>
              )}
            </div>
            <p className="workspace-switcher__meta">
              {selectedCalendar.archived ? <><strong>Archived</strong> · </> : null}
              {selectedCalendar.experimentCount} {selectedCalendar.experimentCount === 1 ? "experiment" : "experiments"} · {selectedCalendar.taskCount} {selectedCalendar.taskCount === 1 ? "task" : "tasks"}
            </p>
          </>
        ) : (
          <button className="workspace-create-button" onClick={onCreateCalendar} type="button">
            <CalendarIcon />
            <span><strong>Create your first calendar</strong><small>Start a new workspace</small></span>
            <PlusIcon />
          </button>
        )}
      </section>

      <div className="sidebar__section-heading">
        <span>Experiments</span>
        <button aria-label="Create experiment" className="icon-button icon-button--accent" disabled={!selectedCalendar || loading} onClick={onCreate} title="Create experiment" type="button">
          <PlusIcon />
        </button>
      </div>

      <nav aria-label="Experiment filters" className="experiment-nav">
        <button
          aria-current={selectedCalendar && selectedExperimentId === null ? "page" : undefined}
          className={`experiment-filter experiment-filter--all ${selectedCalendar && selectedExperimentId === null ? "is-selected" : ""}`}
          disabled={!selectedCalendar}
          onClick={() => onSelect(null)}
          type="button"
        >
          <span className="all-experiments-icon" aria-hidden="true">
            <i /><i /><i />
          </span>
          <span className="experiment-filter__content">
            <span className="experiment-filter__name">All Experiments</span>
            {selectedCalendar && !loading ? <span className="experiment-filter__count">{taskCountLabel(totalTasks)}</span> : null}
          </span>
        </button>

        {!selectedCalendar ? (
          <div className="sidebar-empty sidebar-empty--workspace">
            <p>Create a calendar to organize experiments.</p>
            <button onClick={onCreateCalendar} type="button"><PlusIcon /> Create calendar</button>
          </div>
        ) : loading ? (
          <div aria-label="Loading experiments" className="sidebar-skeletons">
            <span /><span /><span />
          </div>
        ) : experiments.length ? (
          <>
            <div aria-label="Active experiments" className="experiment-group" role="group">
              {archivedExperiments.length ? (
                <div aria-hidden="true" className="experiment-group__heading">
                  <span>Active</span><small>{activeExperiments.length}</small>
                </div>
              ) : null}
              {activeExperiments.length ? activeExperiments.map(renderExperiment) : (
                <div className="sidebar-empty sidebar-empty--compact">
                  <p>No active experiments.</p>
                  <button onClick={onCreate} type="button"><PlusIcon /> Create experiment</button>
                </div>
              )}
            </div>
            {archivedExperiments.length ? (
              <div aria-label="Archived experiments" className="experiment-group experiment-group--archived" role="group">
                <div aria-hidden="true" className="experiment-group__heading">
                  <span>Archived</span><small>{archivedExperiments.length}</small>
                </div>
                {archivedExperiments.map(renderExperiment)}
              </div>
            ) : null}
          </>
        ) : (
          <div className="sidebar-empty">
            <p>No experiments yet.</p>
            <button onClick={onCreate} type="button"><PlusIcon /> Create experiment</button>
          </div>
        )}
      </nav>

      <div className="sidebar__footer">
        <span className="local-status-dot" />
        Data stored locally
      </div>
    </aside>
  );
}
