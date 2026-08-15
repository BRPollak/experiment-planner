import { useEffect, useState, type FormEvent } from "react";
import { errorMessage } from "../lib/api";
import type { MigrationStatus, PlannerCalendar } from "../lib/types";
import { CalendarIcon, PlusIcon } from "./Icons";
import { Modal } from "./Modal";

interface MigrationGateProps {
  calendars: PlannerCalendar[];
  status: MigrationStatus;
  onCreateCalendar: (name: string) => Promise<PlannerCalendar>;
  onMigrate: (calendarId: string) => Promise<void>;
}

function countLabel(count: number, singular: string) {
  return `${count} ${count === 1 ? singular : `${singular}s`}`;
}

export function MigrationGate({ calendars, status, onCreateCalendar, onMigrate }: MigrationGateProps) {
  const [selectedId, setSelectedId] = useState(calendars[0]?.id ?? "");
  const [newName, setNewName] = useState("");
  const [isCreating, setIsCreating] = useState(false);
  const [isMigrating, setIsMigrating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!calendars.some((calendar) => calendar.id === selectedId)) {
      setSelectedId(calendars[0]?.id ?? "");
    }
  }, [calendars, selectedId]);

  const createCalendar = async (event: FormEvent) => {
    event.preventDefault();
    const cleanName = newName.trim();
    if (!cleanName) {
      setError("Enter a name for the new calendar.");
      return;
    }
    setIsCreating(true);
    setError(null);
    try {
      const created = await onCreateCalendar(cleanName);
      setSelectedId(created.id);
      setNewName("");
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsCreating(false);
    }
  };

  const migrate = async () => {
    if (!selectedId) {
      setError("Create or select a destination calendar first.");
      return;
    }
    setIsMigrating(true);
    setError(null);
    try {
      await onMigrate(selectedId);
      setIsMigrating(false);
    } catch (caught) {
      setError(errorMessage(caught));
      setIsMigrating(false);
    }
  };

  return (
    <Modal
      dismissible={false}
      onClose={() => undefined}
      size="large"
      subtitle="A one-time step to organize data created before calendar workspaces were added."
      title="Choose a calendar for your existing data"
    >
      <div className="modal__body migration-gate">
        <div className="migration-summary">
          <span className="migration-summary__icon"><CalendarIcon /></span>
          <div>
            <strong>{countLabel(status.unassignedExperimentCount, "experiment")} and {countLabel(status.unassignedTaskCount, "task")}</strong>
            <p>Choose where these items should live. Existing calendars and everything already inside them will be preserved.</p>
          </div>
        </div>

        <section className="migration-section" aria-labelledby="migration-destination-heading">
          <div className="migration-section__heading">
            <div>
              <h3 id="migration-destination-heading">1. Create or choose a calendar</h3>
              <p>You can create as many calendars as you need before continuing.</p>
            </div>
          </div>

          <form className="migration-create" onSubmit={createCalendar}>
            <label className="field">
              <span className="field__label">New calendar name</span>
              <span className="migration-create__row">
                <input
                  autoFocus={calendars.length === 0}
                  disabled={isCreating || isMigrating}
                  maxLength={120}
                  onChange={(event) => setNewName(event.target.value)}
                  placeholder="Enter calendar name"
                  value={newName}
                />
                <button className="button button--secondary" disabled={isCreating || isMigrating || !newName.trim()} type="submit">
                  <PlusIcon /> {isCreating ? "Adding…" : "Add calendar"}
                </button>
              </span>
            </label>
          </form>

          {calendars.length ? (
            <div aria-label="Migration destination" className="migration-calendar-list" role="radiogroup">
              {calendars.map((calendar) => (
                <label className={`migration-calendar-option ${selectedId === calendar.id ? "is-selected" : ""}`} key={calendar.id}>
                  <input
                    checked={selectedId === calendar.id}
                    disabled={isMigrating}
                    name="migration-calendar"
                    onChange={() => setSelectedId(calendar.id)}
                    type="radio"
                    value={calendar.id}
                  />
                  <span className="migration-calendar-option__icon"><CalendarIcon /></span>
                  <span className="migration-calendar-option__content">
                    <strong>{calendar.name}</strong>
                    <small>{countLabel(calendar.experimentCount, "experiment")} · {countLabel(calendar.taskCount, "task")}</small>
                  </span>
                  <span className="migration-calendar-option__check" aria-hidden="true">✓</span>
                </label>
              ))}
            </div>
          ) : (
            <p className="migration-no-calendars">Create at least one calendar to continue.</p>
          )}
        </section>

        <section className="migration-section migration-section--final">
          <h3>2. Move the existing data</h3>
          <p>The legacy experiments and their tasks will be assigned to the selected calendar. Nothing already in that calendar will be replaced or removed.</p>
        </section>

        {error ? <div className="form-error" role="alert">{error}</div> : null}
      </div>
      <footer className="modal__footer migration-footer">
        <span>This migration only runs once.</span>
        <button className="button button--primary" disabled={!selectedId || isCreating || isMigrating} onClick={migrate} type="button">
          {isMigrating ? "Migrating data…" : "Migrate and continue"}
        </button>
      </footer>
    </Modal>
  );
}
