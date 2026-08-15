import { useState, type FormEvent } from "react";
import type { Experiment, ExperimentInput } from "../../shared/models";
import { errorMessage } from "../lib/api";
import { TrashIcon } from "./Icons";
import { Modal } from "./Modal";

const COLOR_OPTIONS = [
  "#2563eb",
  "#0f766e",
  "#16a34a",
  "#ca8a04",
  "#ea580c",
  "#dc2626",
  "#db2777",
  "#7c3aed",
  "#475569",
];

interface ExperimentEditorProps {
  experiment?: Experiment;
  onSave: (input: Omit<ExperimentInput, "calendarId">) => Promise<void>;
  onRequestDelete?: () => void;
  onClose: () => void;
}

export function ExperimentEditor({
  experiment,
  onSave,
  onRequestDelete,
  onClose,
}: ExperimentEditorProps) {
  const [name, setName] = useState(experiment?.name ?? "");
  const [description, setDescription] = useState(experiment?.description ?? "");
  const [color, setColor] = useState(experiment?.color ?? COLOR_OPTIONS[0]);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    const cleanName = name.trim();
    if (!cleanName) {
      setError("Enter a name for the experiment.");
      return;
    }

    setIsSaving(true);
    setError(null);
    try {
      await onSave({
        name: cleanName,
        color,
        description: description.trim() || null,
      });
    } catch (caught) {
      setError(errorMessage(caught));
      setIsSaving(false);
    }
  };

  return (
    <Modal
      onClose={isSaving ? () => undefined : onClose}
      subtitle={experiment ? "Update how this experiment appears across your calendar." : "Create a color-coded home for related tasks."}
      title={experiment ? "Edit experiment" : "New experiment"}
    >
      <form onSubmit={submit}>
        <div className="modal__body form-stack">
          <label className="field">
            <span className="field__label">Experiment name</span>
            <input
              autoFocus
              maxLength={120}
              onChange={(event) => setName(event.target.value)}
              placeholder="Enter experiment name"
              value={name}
            />
          </label>

          <fieldset className="field color-field">
            <legend className="field__label">Color</legend>
            <div className="color-picker-row">
              <div className="color-swatches">
                {COLOR_OPTIONS.map((option) => (
                  <button
                    aria-label={`Choose color ${option}`}
                    aria-pressed={color.toLowerCase() === option}
                    className="color-swatch"
                    key={option}
                    onClick={() => setColor(option)}
                    style={{ backgroundColor: option }}
                    type="button"
                  >
                    <span />
                  </button>
                ))}
              </div>
              <label className="custom-color" title="Choose a custom color">
                <input aria-label="Choose a custom experiment color" onChange={(event) => setColor(event.target.value)} type="color" value={color} />
                <span>Custom</span>
              </label>
            </div>
          </fieldset>

          <label className="field">
            <span className="field__label field__label--split">
              <span>Description <span className="field__optional">Optional</span></span>
              <span className="character-count">{description.length}/240</span>
            </span>
            <textarea
              maxLength={240}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Add a short description"
              rows={3}
              value={description}
            />
          </label>

          {error ? <div className="form-error" role="alert">{error}</div> : null}
        </div>
        <footer className={`modal__footer ${experiment ? "modal__footer--split" : ""}`}>
          {experiment && onRequestDelete ? (
            <button className="button button--text-danger" disabled={isSaving} onClick={onRequestDelete} type="button">
              <TrashIcon /> Delete experiment
            </button>
          ) : <span />}
          <div className="modal__actions">
            <button className="button button--secondary" disabled={isSaving} onClick={onClose} type="button">
              Cancel
            </button>
            <button className="button button--primary" disabled={isSaving} type="submit">
              {isSaving ? "Saving…" : experiment ? "Save changes" : "Create experiment"}
            </button>
          </div>
        </footer>
      </form>
    </Modal>
  );
}
