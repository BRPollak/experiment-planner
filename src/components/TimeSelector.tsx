import {
  useEffect,
  useId,
  useRef,
  useState,
  type KeyboardEvent as ReactKeyboardEvent,
  type MouseEvent as ReactMouseEvent,
} from "react";
import { formatTaskTime, isValidTaskTime } from "../lib/tasks";
import { ClockIcon, CloseIcon } from "./Icons";

interface TimeSelectorProps {
  value: string;
  onChange: (value: string) => void;
}

interface TimeOption {
  value: string;
  label: string;
}

const TIME_OPTIONS: TimeOption[] = Array.from({ length: 24 * 4 }, (_, index) => {
  const hours = Math.floor(index / 4);
  const minutes = (index % 4) * 15;
  const value = `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  return { value, label: formatTaskTime(value) ?? value };
});

function initialOptionIndex(value: string): number {
  const selectedIndex = TIME_OPTIONS.findIndex((option) => option.value === value);
  if (selectedIndex >= 0) return selectedIndex;

  const now = new Date();
  const roundedQuarter = Math.round((now.getHours() * 60 + now.getMinutes()) / 15);
  return Math.min(TIME_OPTIONS.length - 1, roundedQuarter);
}

export function TimeSelector({ value, onChange }: TimeSelectorProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [activeIndex, setActiveIndex] = useState(() => initialOptionIndex(value));
  const shellRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const optionRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const labelId = useId();
  const valueId = useId();
  const hintId = useId();
  const listboxId = useId();
  const formattedTime = formatTaskTime(value);
  const activeOptionId = `${listboxId}-option-${activeIndex}`;

  useEffect(() => {
    if (!isOpen) return;
    optionRefs.current[activeIndex]?.scrollIntoView?.({ block: "nearest" });
  }, [activeIndex, isOpen]);

  useEffect(() => {
    if (!isOpen) return;

    const handleOutsidePress = (event: MouseEvent) => {
      if (event.target instanceof Node && !shellRef.current?.contains(event.target)) {
        setIsOpen(false);
      }
    };
    document.addEventListener("mousedown", handleOutsidePress, true);
    return () => document.removeEventListener("mousedown", handleOutsidePress, true);
  }, [isOpen]);

  const openPicker = () => {
    triggerRef.current?.focus({ preventScroll: true });
    setActiveIndex(initialOptionIndex(value));
    setIsOpen(true);
  };

  const togglePicker = () => {
    if (isOpen) setIsOpen(false);
    else openPicker();
  };

  const restoreTriggerFocus = () => {
    window.requestAnimationFrame(() => triggerRef.current?.focus());
  };

  const selectOption = (index: number) => {
    const option = TIME_OPTIONS[index];
    if (!option) return;
    onChange(option.value);
    setIsOpen(false);
    restoreTriggerFocus();
  };

  const clearTime = () => {
    onChange("");
    setIsOpen(false);
    restoreTriggerFocus();
  };

  const handleTriggerKeyDown = (event: ReactKeyboardEvent<HTMLButtonElement>) => {
    if (!isOpen) {
      if (event.key === "ArrowDown" || event.key === "ArrowUp") {
        event.preventDefault();
        openPicker();
      }
      return;
    }

    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const direction = event.key === "ArrowDown" ? 1 : -1;
      setActiveIndex((current) => (
        (current + direction + TIME_OPTIONS.length) % TIME_OPTIONS.length
      ));
      return;
    }

    if (event.key === "Home" || event.key === "End") {
      event.preventDefault();
      setActiveIndex(event.key === "Home" ? 0 : TIME_OPTIONS.length - 1);
      return;
    }

    if (event.key === "Enter") {
      event.preventDefault();
      event.stopPropagation();
      selectOption(activeIndex);
      return;
    }

    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      setIsOpen(false);
      restoreTriggerFocus();
      return;
    }

    if (event.key === "Tab") setIsOpen(false);
  };

  const handleControlClick = (event: ReactMouseEvent<HTMLDivElement>) => {
    if (event.currentTarget === event.target) togglePicker();
  };

  return (
    <div className="field time-picker-field">
      <span className="field__label" id={labelId}>
        Time <span className="field__optional">Optional</span>
      </span>
      <div className={`time-picker-shell${isOpen ? " is-open" : ""}`} ref={shellRef}>
        <div className="time-picker-control" onClick={handleControlClick}>
          <button
            aria-activedescendant={isOpen ? activeOptionId : undefined}
            aria-controls={listboxId}
            aria-describedby={hintId}
            aria-expanded={isOpen}
            aria-haspopup="listbox"
            aria-labelledby={`${labelId} ${valueId}`}
            className="time-picker-control__trigger"
            onClick={togglePicker}
            onKeyDown={handleTriggerKeyDown}
            ref={triggerRef}
            role="combobox"
            type="button"
          >
            <span
              aria-live="polite"
              className={`time-picker-control__value${formattedTime ? "" : " is-placeholder"}`}
              id={valueId}
            >
              {formattedTime ?? "No time"}
            </span>
            <ClockIcon />
          </button>
          {isValidTaskTime(value) ? (
            <button
              aria-label="Clear task time"
              className="time-picker-control__clear"
              onClick={clearTime}
              title="Clear time"
              type="button"
            >
              <CloseIcon />
            </button>
          ) : null}
        </div>
        {isOpen ? (
          <div className="time-picker-menu">
            <div aria-label="Task time" className="time-picker-menu__options" id={listboxId} role="listbox">
              {TIME_OPTIONS.map((option, index) => (
                <button
                  aria-selected={index === activeIndex}
                  className="time-picker-menu__option"
                  data-time={option.value}
                  id={`${listboxId}-option-${index}`}
                  key={option.value}
                  onClick={() => selectOption(index)}
                  onMouseDown={(event) => event.preventDefault()}
                  onMouseEnter={() => setActiveIndex(index)}
                  ref={(element) => { optionRefs.current[index] = element; }}
                  role="option"
                  tabIndex={-1}
                  type="button"
                >
                  {option.label}
                </button>
              ))}
            </div>
            <div className="time-picker-menu__hint">Press Enter to select a time</div>
          </div>
        ) : null}
      </div>
      <span className="field__hint" id={hintId}>15-minute increments</span>
    </div>
  );
}
