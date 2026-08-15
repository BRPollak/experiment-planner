import { useEffect, useId, useRef, type ReactNode } from "react";
import { CloseIcon } from "./Icons";

interface ModalProps {
  title: string;
  subtitle?: string;
  onClose: () => void;
  children: ReactNode;
  size?: "small" | "medium" | "large" | "xlarge";
  dismissible?: boolean;
}

export function Modal({ title, subtitle, onClose, children, size = "medium", dismissible = true }: ModalProps) {
  const dialogRef = useRef<HTMLElement>(null);
  const onCloseRef = useRef(onClose);
  const dismissibleRef = useRef(dismissible);
  const titleId = useId();
  const descriptionId = useId();
  onCloseRef.current = onClose;
  dismissibleRef.current = dismissible;

  useEffect(() => {
    const previousFocus = document.activeElement as HTMLElement | null;
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const dialog = dialogRef.current;
    const backgroundElements: Array<{
      element: HTMLElement;
      ariaHidden: string | null;
      inert: boolean;
    }> = [];
    let modalBranch = dialog?.parentElement ?? null;
    while (modalBranch?.parentElement) {
      const parent = modalBranch.parentElement;
      Array.from(parent.children).forEach((sibling) => {
        if (sibling === modalBranch || !(sibling instanceof HTMLElement)) return;
        backgroundElements.push({
          element: sibling,
          ariaHidden: sibling.getAttribute("aria-hidden"),
          inert: Boolean(sibling.inert),
        });
        sibling.inert = true;
        sibling.setAttribute("aria-hidden", "true");
      });
      if (parent === document.body) break;
      modalBranch = parent;
    }

    const getFocusable = () => dialog ? Array.from(
      dialog.querySelectorAll<HTMLElement>(
        'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])',
      ),
    ) : [];
    const focusFirst = () => (getFocusable()[0] ?? dialog)?.focus();
    const autofocusTarget = dialog?.querySelector<HTMLElement>("[autofocus]");
    const firstFormControl = dialog?.querySelector<HTMLElement>(
      "input:not([disabled]), textarea:not([disabled]), select:not([disabled])",
    );
    const firstButton = dialog?.querySelector<HTMLElement>("button:not([disabled])");
    window.requestAnimationFrame(() => (
      autofocusTarget ?? firstFormControl ?? firstButton ?? dialog
    )?.focus());

    const handleFocusIn = (event: FocusEvent) => {
      if (dialog && !dialog.contains(event.target as Node)) focusFirst();
    };

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape" && dismissibleRef.current) {
        event.preventDefault();
        onCloseRef.current();
        return;
      }

      if (event.key !== "Tab" || !dialog) return;
      const focusable = getFocusable();
      if (!focusable.length) {
        event.preventDefault();
        dialog.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (!dialog.contains(document.activeElement)) {
        event.preventDefault();
        (event.shiftKey ? last : first).focus();
      } else if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.addEventListener("focusin", handleFocusIn);
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.removeEventListener("focusin", handleFocusIn);
      backgroundElements.forEach(({ element, ariaHidden, inert }) => {
        element.inert = inert;
        if (ariaHidden === null) element.removeAttribute("aria-hidden");
        else element.setAttribute("aria-hidden", ariaHidden);
      });
      document.body.style.overflow = previousOverflow;
      if (previousFocus?.isConnected) previousFocus.focus();
    };
  }, []);

  return (
    <div
      className="modal-backdrop"
      onMouseDown={(event) => {
        if (dismissible && event.currentTarget === event.target) onClose();
      }}
    >
      <section
        aria-describedby={subtitle ? descriptionId : undefined}
        aria-labelledby={titleId}
        aria-modal="true"
        className={`modal modal--${size}`}
        ref={dialogRef}
        role="dialog"
        tabIndex={-1}
      >
        <header className="modal__header">
          <div>
            <h2 id={titleId}>{title}</h2>
            {subtitle ? <p id={descriptionId}>{subtitle}</p> : null}
          </div>
          {dismissible ? (
            <button aria-label="Close dialog" className="icon-button" onClick={onClose} type="button">
              <CloseIcon />
            </button>
          ) : null}
        </header>
        {children}
      </section>
    </div>
  );
}
