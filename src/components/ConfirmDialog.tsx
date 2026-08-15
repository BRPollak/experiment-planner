import { useState } from "react";
import { errorMessage } from "../lib/api";
import { Modal } from "./Modal";

interface ConfirmDialogProps {
  title: string;
  message: string;
  detail?: string;
  confirmLabel: string;
  onConfirm: () => Promise<void>;
  onClose: () => void;
}

export function ConfirmDialog({
  title,
  message,
  detail,
  confirmLabel,
  onConfirm,
  onClose,
}: ConfirmDialogProps) {
  const [isWorking, setIsWorking] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const confirm = async () => {
    setIsWorking(true);
    setError(null);
    try {
      await onConfirm();
    } catch (caught) {
      setError(errorMessage(caught));
      setIsWorking(false);
    }
  };

  return (
    <Modal onClose={isWorking ? () => undefined : onClose} size="small" title={title}>
      <div className="modal__body confirm-dialog">
        <p className="confirm-dialog__message">{message}</p>
        {detail ? <p className="confirm-dialog__detail">{detail}</p> : null}
        {error ? <div className="form-error" role="alert">{error}</div> : null}
      </div>
      <footer className="modal__footer">
        <button className="button button--secondary" disabled={isWorking} onClick={onClose} type="button">
          Cancel
        </button>
        <button className="button button--danger" disabled={isWorking} onClick={confirm} type="button">
          {isWorking ? "Deleting…" : confirmLabel}
        </button>
      </footer>
    </Modal>
  );
}
