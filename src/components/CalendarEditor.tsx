import { useState, type FormEvent } from "react";
import type { CalendarInput, PlannerCalendar } from "../lib/types";
import { errorMessage } from "../lib/api";
import { TrashIcon } from "./Icons";
import { Modal } from "./Modal";

interface CalendarEditorProps {
  calendar?: PlannerCalendar;
  onSave: (input: CalendarInput) => Promise<void>;
  onRequestDelete?: () => void;
  onClose: () => void;
}

export function CalendarEditor({ calendar, onSave, onRequestDelete, onClose }: CalendarEditorProps) {
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
          {calendar && onRequestDelete ? (
            <button className="button button--text-danger" disabled={isSaving} onClick={onRequestDelete} type="button">
              <TrashIcon /> Delete calendar
            </button>
          ) : <span />}
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
