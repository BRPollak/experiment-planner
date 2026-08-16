import { useState, type FormEvent } from "react";
import type { CalendarInput, PlannerCalendar } from "../lib/types";
import { errorMessage } from "../lib/api";
import { ArchiveIcon, RestoreIcon, TrashIcon } from "./Icons";
import { Modal } from "./Modal";

interface CalendarEditorProps {
  calendar?: PlannerCalendar;
  onSave: (input: CalendarInput) => Promise<void>;
  onArchive?: () => Promise<void>;
  onUnarchive?: () => Promise<void>;
  onRequestDelete?: () => void;
  onClose: () => void;
}

export function CalendarEditor({
  calendar,
  onSave,
  onArchive,
  onUnarchive,
  onRequestDelete,
  onClose,
}: CalendarEditorProps) {
  const [name, setName] = useState(calendar?.name ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setError("Enter a name for the calendar.");
      return;
    }
    setIsSaving(true);
    setError(null);
    try {
      await onSave({ name: cleanName });
    } catch (caught) {
      setError(errorMessage(caught));
      setIsSaving(false);
    }
  };

  const updateArchiveState = async (action: () => Promise<void>) => {
    setIsSaving(true);
    setError(null);
    try {
      await action();
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setIsSaving(false);
    }
  };

  const lifecycleActions = calendar ? (
    calendar.archived ? (
      <div className="modal__lifecycle-actions">
        {onUnarchive ? (
          <button
            className="button button--text"
            disabled={isSaving}
            onClick={() => void updateArchiveState(onUnarchive)}
            type="button"
          >
            <RestoreIcon /> Unarchive calendar
          </button>
        ) : null}
        {onRequestDelete ? (
          <button
            className="button button--text-danger"
            disabled={isSaving}
            onClick={onRequestDelete}
            type="button"
          >
            <TrashIcon /> Delete calendar
          </button>
        ) : null}
      </div>
    ) : onArchive ? (
      <button
        className="button button--text"
        disabled={isSaving}
        onClick={() => void updateArchiveState(onArchive)}
        type="button"
      >
        <ArchiveIcon /> Archive calendar
      </button>
    ) : null
  ) : null;

  return (
    <Modal
      onClose={isSaving ? () => undefined : onClose}
      subtitle={calendar ? "Rename this calendar workspace." : "Keep a group of experiments in its own focused workspace."}
      title={calendar ? "Rename calendar" : "New calendar"}
    >
      <form onSubmit={submit}>
        <div className="modal__body form-stack">
          <label className="field">
            <span className="field__label">Calendar name</span>
            <input
              autoFocus
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="Enter calendar name"
              value={name}
            />
          </label>
          {error ? <div className="form-error" role="alert">{error}</div> : null}
        </div>
        <footer className={`modal__footer ${calendar ? "modal__footer--split" : ""}`}>
          {lifecycleActions ?? <span />}
          <div className="modal__actions">
            <button className="button button--secondary" disabled={isSaving} onClick={onClose} type="button">Cancel</button>
            <button className="button button--primary" disabled={isSaving} type="submit">
              {isSaving ? "Saving…" : calendar ? "Save name" : "Create calendar"}
            </button>
          </div>
        </footer>
      </form>
    </Modal>
  );
}
