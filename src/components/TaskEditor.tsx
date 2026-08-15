import { useState, type FormEvent } from "react";
import type { Experiment, Task, TaskInput } from "../../shared/models";
import { errorMessage } from "../lib/api";
import { friendlyDate } from "../lib/dates";
import { isValidTaskTime } from "../lib/tasks";
import { TrashIcon } from "./Icons";
import { Modal } from "./Modal";
import { TimeSelector } from "./TimeSelector";

interface TaskEditorProps {
  experiments: Experiment[];
  task?: Task;
  initialDate: string;
  initialExperimentId?: string;
  onSave: (input: TaskInput) => Promise<void>;
  onRequestDelete?: () => void;
  onClose: () => void;
}

export function TaskEditor({
  experiments,
  task,
  initialDate,
  initialExperimentId,
  onSave,
  onRequestDelete,
  onClose,
}: TaskEditorProps) {
  const [name, setName] = useState(task?.name ?? "");
  const [date, setDate] = useState(task?.date ?? initialDate);
  const [time, setTime] = useState(task?.time ?? "");
  const [experimentId, setExperimentId] = useState(
    task?.experimentId ?? initialExperimentId ?? experiments[0]?.id ?? "",
  );
  const [notes, setNotes] = useState(task?.notes ?? "");
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) {
      setError("Enter a task name.");
      return;
    }
    if (!date) {
      setError("Choose a date for this task.");
      return;
    }
    if (!experimentId) {
      setError("Choose an experiment for this task.");
      return;
    }
    if (time && !isValidTaskTime(time)) {
      setError("Choose a time in 15-minute increments.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await onSave({
        name: name.trim(),
        date,
        time: time || null,
        experimentId,
        notes: notes.trim() || null,
      });
    } catch (caught) {
      setError(errorMessage(caught));
      setIsSaving(false);
    }
  };

  return (
    <Modal
      onClose={isSaving ? () => undefined : onClose}
      subtitle={date ? friendlyDate(date) : undefined}
      title={task ? "Edit task" : "New task"}
    >
      <form onSubmit={submit}>
        <div className="modal__body form-stack">
          <label className="field">
            <span className="field__label">Task name</span>
            <input
              autoFocus
              maxLength={160}
              onChange={(event) => setName(event.target.value)}
              placeholder="What needs to be done?"
              value={name}
            />
          </label>

          <div className="form-row task-schedule-row">
            <label className="field">
              <span className="field__label">Date</span>
              <input onChange={(event) => setDate(event.target.value)} type="date" value={date} />
            </label>
            <TimeSelector onChange={setTime} value={time} />
            <label className="field">
              <span className="field__label">Experiment</span>
              <select onChange={(event) => setExperimentId(event.target.value)} value={experimentId}>
                {experiments.map((experiment) => (
                  <option key={experiment.id} value={experiment.id}>{experiment.name}</option>
                ))}
              </select>
            </label>
          </div>

          <label className="field">
            <span className="field__label">Notes <span className="field__optional">Optional</span></span>
            <textarea
              maxLength={4000}
              onChange={(event) => setNotes(event.target.value)}
              placeholder="Add context or details"
              rows={5}
              value={notes}
            />
          </label>

          {error ? <div className="form-error" role="alert">{error}</div> : null}
        </div>
        <footer className={`modal__footer ${task ? "modal__footer--split" : ""}`}>
          {task && onRequestDelete ? (
            <button className="button button--text-danger" disabled={isSaving} onClick={onRequestDelete} type="button">
              <TrashIcon /> Delete task
            </button>
          ) : <span />}
          <div className="modal__actions">
            <button className="button button--secondary" disabled={isSaving} onClick={onClose} type="button">Cancel</button>
            <button className="button button--primary" disabled={isSaving} type="submit">
              {isSaving ? "Saving…" : task ? "Save changes" : "Create task"}
            </button>
          </div>
        </footer>
      </form>
    </Modal>
  );
}
