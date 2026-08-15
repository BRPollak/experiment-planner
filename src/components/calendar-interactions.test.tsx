import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { act, useState, type ReactElement } from "react";
import type { Root } from "react-dom/client";
import { JSDOM } from "jsdom";

import type { Experiment, Task, TaskInput } from "../../shared/models";
import { DayView } from "./DayView";
import { Modal } from "./Modal";
import { MonthCalendar } from "./MonthCalendar";
import { TaskEditor } from "./TaskEditor";

const experimentAlpha: Experiment = {
  id: "alpha",
  name: "Alpha experiment",
  color: "#2563EB",
  description: null,
  calendarId: "calendar",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  taskCount: 0,
};

const experimentBeta: Experiment = {
  ...experimentAlpha,
  id: "beta",
  name: "Beta experiment",
  color: "#16A34A",
};

function makeTask(id: string, overrides: Partial<Task> = {}): Task {
  return {
    id,
    name: id,
    date: "2026-08-01",
    time: null,
    experimentId: experimentAlpha.id,
    notes: null,
    createdAt: "2026-01-01T08:00:00.000Z",
    updatedAt: "2026-01-01T08:00:00.000Z",
    ...overrides,
  };
}

const exposedGlobalNames = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "KeyboardEvent",
  "MouseEvent",
  "Event",
  "getComputedStyle",
  "IS_REACT_ACT_ENVIRONMENT",
] as const;

function exposeDom(nextDom: JSDOM): void {
  const exposedGlobals: Record<string, unknown> = {
    window: nextDom.window,
    document: nextDom.window.document,
    navigator: nextDom.window.navigator,
    Node: nextDom.window.Node,
    HTMLElement: nextDom.window.HTMLElement,
    HTMLButtonElement: nextDom.window.HTMLButtonElement,
    HTMLInputElement: nextDom.window.HTMLInputElement,
    KeyboardEvent: nextDom.window.KeyboardEvent,
    MouseEvent: nextDom.window.MouseEvent,
    Event: nextDom.window.Event,
    getComputedStyle: nextDom.window.getComputedStyle.bind(nextDom.window),
  };
  Object.entries(exposedGlobals).forEach(([name, value]) => {
    Object.defineProperty(globalThis, name, { configurable: true, value });
  });
  Object.defineProperty(globalThis, "IS_REACT_ACT_ENVIRONMENT", {
    configurable: true,
    value: true,
  });
  nextDom.window.requestAnimationFrame = (callback: FrameRequestCallback) => {
    callback(0);
    return 1;
  };
  nextDom.window.cancelAnimationFrame = () => undefined;
  Object.defineProperties(nextDom.window.HTMLElement.prototype, {
    attachEvent: { configurable: true, value: () => undefined },
    detachEvent: { configurable: true, value: () => undefined },
  });
}

function clearDomGlobals(): void {
  exposedGlobalNames.forEach((name) => Reflect.deleteProperty(globalThis, name));
}

// react-dom performs DOM capability detection when imported. Give that check a
// real document before loading it, then replace the document for each test.
const bootstrapDom = new JSDOM("<!doctype html><html><body></body></html>", {
  url: "http://localhost/",
});
exposeDom(bootstrapDom);
const { createRoot } = await import("react-dom/client");
bootstrapDom.window.close();
clearDomGlobals();

let dom: JSDOM;
let roots: Root[];

beforeEach(() => {
  dom = new JSDOM("<!doctype html><html><body></body></html>", {
    url: "http://localhost/",
  });
  roots = [];
  exposeDom(dom);
});

afterEach(() => {
  roots.reverse().forEach((root) => act(() => root.unmount()));
  dom.window.close();
  clearDomGlobals();
});

function render(element: ReactElement): HTMLElement {
  const container = document.createElement("div");
  document.body.append(container);
  const root = createRoot(container);
  roots.push(root);
  act(() => root.render(element));
  return container;
}

function click(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
  });
}

function mouseDown(element: Element): void {
  act(() => {
    element.dispatchEvent(new MouseEvent("mousedown", { bubbles: true, cancelable: true }));
  });
}

function keyDown(element: EventTarget, key: string, shiftKey = false): KeyboardEvent {
  let event!: KeyboardEvent;
  act(() => {
    event = new KeyboardEvent("keydown", {
      bubbles: true,
      cancelable: true,
      key,
      shiftKey,
    });
    element.dispatchEvent(event);
  });
  return event;
}

function requireElement<TElement extends Element>(
  root: ParentNode,
  selector: string,
): TElement {
  const element = root.querySelector<TElement>(selector);
  assert.ok(element, `Expected ${selector}`);
  return element;
}

interface CalendarSpies {
  created: string[];
  edited: Task[];
  opened: string[];
}

function renderCalendar(
  tasks: Task[] = [],
  movingTaskIds: ReadonlySet<string> = new Set(),
  month = new Date(2026, 7, 1),
): { container: HTMLElement; spies: CalendarSpies } {
  const spies: CalendarSpies = { created: [], edited: [], opened: [] };
  const container = render(
    <MonthCalendar
      experiments={[experimentAlpha, experimentBeta]}
      hasCalendar
      loading={false}
      month={month}
      movingTaskIds={movingTaskIds}
      onCreateCalendar={() => undefined}
      onCreateExperiment={() => undefined}
      onCreateTask={(date) => spies.created.push(date)}
      onEditTask={(task) => spies.edited.push(task)}
      onMonthChange={() => undefined}
      onMoveTask={() => undefined}
      onOpenDay={(date) => spies.opened.push(date)}
      selectedCalendarName="Calendar"
      selectedExperimentId={null}
      tasks={tasks}
    />,
  );
  return { container, spies };
}

test("calendar cells and day numbers open the expanded day view", () => {
  const { container, spies } = renderCalendar();
  const cell = requireElement<HTMLElement>(container, '[data-date-key="2026-08-01"]');

  click(cell);
  assert.deepEqual(spies.opened, ["2026-08-01"]);
  assert.deepEqual(spies.created, []);

  click(requireElement(cell, ".day-number"));
  assert.deepEqual(spies.opened, ["2026-08-01", "2026-08-01"]);
});

test("the per-day add button creates for its date without opening the day view", () => {
  const { container, spies } = renderCalendar();
  const cell = requireElement<HTMLElement>(container, '[data-date-key="2026-08-03"]');
  const addButton = requireElement<HTMLButtonElement>(cell, ".calendar-day__add-task");

  act(() => addButton.focus());
  assert.equal(document.activeElement, addButton);
  assert.equal(addButton.tabIndex, 0);
  click(addButton);

  assert.deepEqual(spies.created, ["2026-08-03"]);
  assert.deepEqual(spies.opened, []);
});

test("clicking an existing task edits it without opening the day view", () => {
  const task = makeTask("Run assay", { time: "09:15", notes: "Protocol details" });
  const { container, spies } = renderCalendar([task]);
  const cell = requireElement<HTMLElement>(container, '[data-date-key="2026-08-01"]');

  click(requireElement(cell, ".calendar-task"));

  assert.deepEqual(spies.edited.map(({ id }) => id), [task.id]);
  assert.deepEqual(spies.opened, []);
  assert.match(requireElement(cell, ".calendar-task__time").textContent ?? "", /9:15/);
});

test("a click originating inside a disabled moving task never activates its day cell", () => {
  const task = makeTask("Moving task");
  const { container, spies } = renderCalendar([task], new Set([task.id]));
  const cell = requireElement<HTMLElement>(container, '[data-date-key="2026-08-01"]');
  const taskButton = requireElement<HTMLButtonElement>(cell, ".calendar-task");

  assert.equal(taskButton.disabled, true);
  click(requireElement(taskButton, ".calendar-task__name"));
  assert.deepEqual(spies.opened, []);
  assert.deepEqual(spies.edited, []);
});

test("arrow keys follow chronology across Sunday-first row boundaries", () => {
  const { container, spies } = renderCalendar();
  const firstSunday = requireElement<HTMLElement>(container, '[data-date-key="2026-07-26"]');
  const firstMonday = requireElement<HTMLElement>(container, '[data-date-key="2026-07-27"]');
  const saturday = requireElement<HTMLElement>(container, '[data-date-key="2026-08-01"]');
  const nextSunday = requireElement<HTMLElement>(container, '[data-date-key="2026-08-02"]');
  const monday = requireElement<HTMLElement>(container, '[data-date-key="2026-08-03"]');
  const nextMonday = requireElement<HTMLElement>(container, '[data-date-key="2026-08-10"]');
  const finalSaturday = requireElement<HTMLElement>(container, '[data-date-key="2026-09-05"]');

  act(() => firstSunday.focus());
  const firstBoundary = keyDown(firstSunday, "ArrowLeft");
  assert.equal(firstBoundary.defaultPrevented, true);
  assert.equal(document.activeElement, firstSunday);
  keyDown(firstSunday, "ArrowRight");
  assert.equal(document.activeElement, firstMonday);
  act(() => saturday.focus());
  keyDown(saturday, "ArrowRight");
  assert.equal(document.activeElement, nextSunday);
  assert.deepEqual(
    [...container.querySelectorAll<HTMLElement>(".calendar-day")]
      .filter((node) => node.tabIndex === 0)
      .map((node) => node.dataset.dateKey),
    ["2026-08-02"],
  );
  keyDown(nextSunday, "ArrowLeft");
  assert.equal(document.activeElement, saturday);
  assert.deepEqual(
    [...container.querySelectorAll<HTMLElement>(".calendar-day")]
      .filter((node) => node.tabIndex === 0)
      .map((node) => node.dataset.dateKey),
    ["2026-08-01"],
  );
  act(() => monday.focus());
  keyDown(monday, "ArrowDown");
  assert.equal(document.activeElement, nextMonday);
  keyDown(nextMonday, "ArrowUp");
  assert.equal(document.activeElement, monday);
  act(() => finalSaturday.focus());
  const finalBoundary = keyDown(finalSaturday, "ArrowRight");
  assert.equal(finalBoundary.defaultPrevented, true);
  assert.equal(document.activeElement, finalSaturday);

  const addButton = requireElement(monday, ".calendar-day__add-task");
  keyDown(addButton, "Enter");
  assert.deepEqual(spies.opened, []);
});

test("headers, dates, tasks, and weekends follow chronological Sunday-first columns", () => {
  const saturdayTask = makeTask("Saturday task", { date: "2026-08-01" });
  const mondayTask = makeTask("Monday task", { date: "2026-07-27" });
  const { container } = renderCalendar([mondayTask, saturdayTask]);

  assert.deepEqual(
    [...container.querySelectorAll(".weekday-header > div")].map((node) => node.textContent),
    ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"],
  );
  assert.deepEqual(
    [...container.querySelectorAll<HTMLElement>(".weekday-header > div")]
      .map((node) => node.dataset.weekday),
    ["0", "1", "2", "3", "4", "5", "6"],
  );
  const firstRow = [...container.querySelectorAll<HTMLElement>(".calendar-day")].slice(0, 7);
  assert.deepEqual(firstRow.map((node) => node.dataset.dateKey), [
    "2026-07-26",
    "2026-07-27",
    "2026-07-28",
    "2026-07-29",
    "2026-07-30",
    "2026-07-31",
    "2026-08-01",
  ]);
  assert.deepEqual(firstRow.map((node) => node.dataset.weekday), ["0", "1", "2", "3", "4", "5", "6"]);
  assert.equal(firstRow[0].classList.contains("is-weekend"), true);
  assert.equal(firstRow[1].classList.contains("is-weekend"), false);
  assert.equal(firstRow[6].classList.contains("is-weekend"), true);
  assert.match(firstRow[1].textContent ?? "", /Monday task/);
  assert.match(firstRow[6].textContent ?? "", /Saturday task/);

  const saturday = requireElement<HTMLElement>(container, '[data-date-key="2026-08-01"]');
  assert.equal(saturday.dataset.weekday, "6");
  assert.equal(saturday.classList.contains("is-weekend"), true);
  assert.match(saturday.textContent ?? "", /Saturday task/);

  const august15Index = [...container.querySelectorAll<HTMLElement>(".calendar-day")]
    .findIndex((node) => node.dataset.dateKey === "2026-08-15");
  const august15Row = [...container.querySelectorAll<HTMLElement>(".calendar-day")]
    .slice(august15Index - (august15Index % 7), august15Index - (august15Index % 7) + 7);
  assert.deepEqual(august15Row.map((node) => node.dataset.dateKey), [
    "2026-08-09",
    "2026-08-10",
    "2026-08-11",
    "2026-08-12",
    "2026-08-13",
    "2026-08-14",
    "2026-08-15",
  ]);

  const cells = [...container.querySelectorAll<HTMLElement>(".calendar-day")];
  assert.equal(cells.filter((node) => node.tabIndex === 0).length, 1);
  act(() => requireElement<HTMLElement>(container, '[data-date-key="2026-08-10"]').focus());
  assert.equal(cells.filter((node) => node.tabIndex === 0).length, 1);
  const activeMonday = requireElement<HTMLElement>(container, '[data-date-key="2026-08-10"]');
  assert.equal(activeMonday.tabIndex, 0);
  assert.ok(
    [...container.querySelectorAll<HTMLElement>(".calendar-day, .calendar-day button")]
      .filter((node) => node.tabIndex === 0 && !(node instanceof HTMLButtonElement && node.disabled))
      .every((node) => node === activeMonday || activeMonday.contains(node)),
  );
  assert.equal(
    requireElement<HTMLButtonElement>(container, '[data-date-key="2026-08-08"] .day-number').tabIndex,
    -1,
  );
});

test("a non-current month beginning Saturday enters the grid on day one", () => {
  const { container } = renderCalendar([], new Set(), new Date(2027, 4, 1));
  const tabStops = [...container.querySelectorAll<HTMLElement>(".calendar-day")]
    .filter((node) => node.tabIndex === 0);

  assert.equal(tabStops.length, 1);
  assert.equal(tabStops[0].dataset.dateKey, "2027-05-01");
});

test("calendar and expanded day view expose the same shared task order", () => {
  const tasks = [
    makeTask("Untimed", { createdAt: "2026-01-01T07:00:00.000Z" }),
    makeTask("Later", { time: "14:30", createdAt: "2026-01-01T06:00:00.000Z" }),
    makeTask("Same time newer", { time: "09:15", createdAt: "2026-01-01T09:00:00.000Z" }),
    makeTask("Same time older", { time: "09:15", createdAt: "2026-01-01T08:00:00.000Z" }),
  ];
  const { container: calendar } = renderCalendar(tasks);
  const day = requireElement(calendar, '[data-date-key="2026-08-01"]');
  const calendarOrder = [...day.querySelectorAll(".calendar-task__name")]
    .map((node) => node.textContent);

  const detail = render(
    <DayView
      date="2026-08-01"
      experiments={[experimentAlpha]}
      onClose={() => undefined}
      onCreateTask={() => undefined}
      onEditTask={() => undefined}
      tasks={tasks}
    />,
  );
  const detailOrder = [...detail.querySelectorAll(".day-view__task-name")]
    .map((node) => node.textContent);

  assert.deepEqual(calendarOrder, ["Same time older", "Same time newer", "Later", "Untimed"]);
  assert.deepEqual(detailOrder, calendarOrder);
});

test("the add-task control defaults visible for no-hover devices and reveals smoothly on fine pointers", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  assert.match(css, /\.calendar-day__add-task\s*{[^}]*opacity:\s*0\.78/s);
  assert.match(css, /@media \(hover: hover\) and \(pointer: fine\)/);
  assert.match(css, /\.calendar-day:hover \.calendar-day__add-task,[\s\S]*\.calendar-day:focus-within \.calendar-day__add-task/);
  assert.match(css, /transition:[^;]*opacity[^;]*transform/);
});

test("weekend headers and cells use the subtle planning treatment", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");
  const style = document.createElement("style");
  style.textContent = css;
  document.head.append(style);
  const { container } = renderCalendar([], new Set(), new Date(2024, 8, 1));

  const sundayHeader = requireElement<HTMLElement>(container, '.weekday-header > [data-weekday="0"]');
  const saturdayHeader = requireElement<HTMLElement>(container, '.weekday-header > [data-weekday="6"]');
  const monday = requireElement<HTMLElement>(container, '[data-date-key="2024-09-02"]');
  const saturday = requireElement<HTMLElement>(container, '[data-date-key="2024-09-07"]');
  const sunday = requireElement<HTMLElement>(container, '[data-date-key="2024-09-08"]');
  const outsideSaturday = requireElement<HTMLElement>(container, '[data-date-key="2024-10-05"]');

  assert.equal(getComputedStyle(sundayHeader).backgroundColor, "rgb(238, 243, 248)");
  assert.equal(getComputedStyle(sundayHeader).color, "rgb(79, 96, 117)");
  assert.equal(getComputedStyle(saturdayHeader).backgroundColor, "rgb(238, 243, 248)");
  assert.equal(getComputedStyle(saturdayHeader).color, "rgb(79, 96, 117)");
  assert.equal(getComputedStyle(monday).backgroundColor, "rgb(255, 255, 255)");
  assert.equal(getComputedStyle(saturday).backgroundColor, "rgb(244, 247, 251)");
  assert.equal(getComputedStyle(sunday).backgroundColor, "rgb(244, 247, 251)");
  assert.equal(getComputedStyle(outsideSaturday).backgroundColor, "rgb(241, 245, 249)");
  outsideSaturday.classList.add("is-today");
  assert.equal(getComputedStyle(outsideSaturday).backgroundColor, "rgb(251, 253, 255)");
  assert.match(css, /\.calendar-day:where\(\.is-weekend:hover\)\s*\{[^}]*background:\s*#edf3f9;/s);
  assert.match(css, /\.calendar-day:where\(\.is-drop-target\)\s*\{[^}]*background:\s*var\(--accent-soft\);/s);
});

test("day view groups in first-task order and renders time plus only nonblank descriptions", () => {
  const tasks = [
    makeTask("Alpha later", { time: "11:00", notes: "   ", experimentId: "alpha" }),
    makeTask("Unknown", { time: "09:00", experimentId: "missing" }),
    makeTask("Beta first", { time: "08:00", experimentId: "beta" }),
    makeTask("Alpha notes", {
      time: "10:00",
      notes: "First line\nSecond line",
      experimentId: "alpha",
    }),
  ];
  const container = render(
    <DayView
      date="2026-08-01"
      experiments={[experimentAlpha, experimentBeta]}
      onClose={() => undefined}
      onCreateTask={() => undefined}
      onEditTask={() => undefined}
      tasks={tasks}
    />,
  );

  assert.deepEqual(
    [...container.querySelectorAll(".day-view__group-header h3")].map((node) => node.textContent),
    ["Beta experiment", "No experiment", "Alpha experiment"],
  );
  const alphaTasks = [...container.querySelectorAll(".day-view__group")][2]
    .querySelectorAll(".day-view__task-name");
  assert.deepEqual([...alphaTasks].map((node) => node.textContent), ["Alpha notes", "Alpha later"]);
  assert.match(container.textContent ?? "", /8:00/);
  assert.match(container.textContent ?? "", /First line\s*Second line/);
  assert.equal(container.querySelectorAll(".day-view__task-notes").length, 1);
});

test("day view respects the filtered task list and shows an intentional empty state", () => {
  const filtered = render(
    <DayView
      date="2026-08-01"
      experiments={[experimentAlpha, experimentBeta]}
      onClose={() => undefined}
      onCreateTask={() => undefined}
      onEditTask={() => undefined}
      tasks={[makeTask("Visible alpha"), makeTask("Other date", { date: "2026-08-02" })]}
    />,
  );
  assert.match(filtered.textContent ?? "", /Visible alpha/);
  assert.doesNotMatch(filtered.textContent ?? "", /Other date|Beta experiment/);

  const empty = render(
    <DayView
      date="2026-08-03"
      experiments={[experimentAlpha]}
      onClose={() => undefined}
      onCreateTask={() => undefined}
      onEditTask={() => undefined}
      tasks={[]}
    />,
  );
  assert.match(empty.textContent ?? "", /No visible tasks for this day/);
  assert.ok(empty.querySelector(".day-view__empty"));
});

test("Escape closes the day view and restores focus to its trigger", () => {
  const trigger = document.createElement("button");
  trigger.textContent = "Open day";
  document.body.append(trigger);
  trigger.focus();

  function DayViewHarness() {
    const [open, setOpen] = useState(true);
    return open ? (
      <DayView
        date="2026-08-01"
        experiments={[experimentAlpha]}
        onClose={() => setOpen(false)}
        onCreateTask={() => undefined}
        onEditTask={() => undefined}
        tasks={[makeTask("Task")]}
      />
    ) : null;
  }

  const container = render(<DayViewHarness />);
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Close dialog");
  assert.equal(trigger.inert, true);
  assert.equal(trigger.getAttribute("aria-hidden"), "true");
  act(() => trigger.focus());
  assert.equal(document.activeElement?.getAttribute("aria-label"), "Close dialog");
  keyDown(document, "Escape");

  assert.equal(container.querySelector('[role="dialog"]'), null);
  assert.equal(trigger.inert, false);
  assert.equal(trigger.hasAttribute("aria-hidden"), false);
  assert.equal(document.activeElement, trigger);
});

test("the day modal traps focus and only a direct backdrop press dismisses it", () => {
  let closeCount = 0;
  const container = render(
    <DayView
      date="2026-08-01"
      experiments={[experimentAlpha]}
      onClose={() => { closeCount += 1; }}
      onCreateTask={() => undefined}
      onEditTask={() => undefined}
      tasks={[makeTask("Task")]}
    />,
  );
  const buttons = [...container.querySelectorAll<HTMLButtonElement>('[role="dialog"] button')];
  const first = buttons[0];
  const last = buttons[buttons.length - 1];

  act(() => first.focus());
  keyDown(first, "Tab", true);
  assert.equal(document.activeElement, last);
  keyDown(last, "Tab");
  assert.equal(document.activeElement, first);

  mouseDown(requireElement(container, ".day-view__group-header"));
  assert.equal(closeCount, 0);
  mouseDown(requireElement(container, ".modal-backdrop"));
  assert.equal(closeCount, 1);
});

test("modal focus is stable when its parent rerenders with a fresh close callback", () => {
  let rerenderParent: () => void = () => undefined;

  function RerenderingModalHarness() {
    const [revision, setRevision] = useState(0);
    rerenderParent = () => setRevision((current) => current + 1);
    return (
      <Modal onClose={() => undefined} title="Stable focus">
        <div className="modal__body">
          <input aria-label="First field" />
          <input aria-label="Second field" />
          <span>{revision}</span>
        </div>
      </Modal>
    );
  }

  const container = render(<RerenderingModalHarness />);
  const secondField = requireElement<HTMLInputElement>(container, '[aria-label="Second field"]');
  act(() => secondField.focus());
  act(() => rerenderParent());
  assert.equal(document.activeElement, secondField);
});

test("day-view add closes before opening task creation for the selected date", () => {
  const events: string[] = [];
  const container = render(
    <DayView
      date="2026-08-01"
      experiments={[experimentAlpha]}
      onClose={() => events.push("close")}
      onCreateTask={(date) => events.push(`create:${date}`)}
      onEditTask={() => undefined}
      tasks={[makeTask("Task")]}
    />,
  );
  const addButton = [...container.querySelectorAll("button")]
    .find((button) => button.textContent?.includes("Add task"));
  assert.ok(addButton);
  click(addButton);
  assert.deepEqual(events, ["close", "create:2026-08-01"]);
});

test("day view disables task editing while a date move is being saved", () => {
  const task = makeTask("Moving task");
  let edited = false;
  const container = render(
    <DayView
      date="2026-08-01"
      experiments={[experimentAlpha]}
      movingTaskIds={new Set([task.id])}
      onClose={() => undefined}
      onCreateTask={() => undefined}
      onEditTask={() => { edited = true; }}
      tasks={[task]}
    />,
  );
  const taskButton = requireElement<HTMLButtonElement>(container, ".day-view__task");
  assert.equal(taskButton.disabled, true);
  assert.match(taskButton.getAttribute("aria-label") ?? "", /saving its new date/);
  click(taskButton);
  assert.equal(edited, false);
});

test("the full time field opens a menu containing exactly every quarter hour", async () => {
  let saved: TaskInput | undefined;
  const container = render(
    <TaskEditor
      experiments={[experimentAlpha]}
      initialDate="2026-08-01"
      initialExperimentId={experimentAlpha.id}
      onClose={() => undefined}
      onSave={async (input) => { saved = input; }}
      task={makeTask("Timed task", { time: "09:15" })}
    />,
  );
  const control = requireElement(container, ".time-picker-control");
  const trigger = requireElement<HTMLButtonElement>(container, '[role="combobox"]');
  const displayedTime = requireElement(container, ".time-picker-control__value");
  assert.equal(container.querySelector('input[type="time"]'), null);
  assert.equal(trigger.type, "button");
  assert.match(displayedTime.textContent ?? "", /9:15/);

  click(displayedTime);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.ok(container.querySelector('[role="listbox"]'));
  assert.equal(
    requireElement(container, ".time-picker-menu__hint").textContent,
    "Press Enter to select a time",
  );

  const options = [...container.querySelectorAll<HTMLButtonElement>('[role="option"]')];
  const expectedTimes = Array.from({ length: 96 }, (_, index) => {
    const hours = Math.floor(index / 4);
    const minutes = (index % 4) * 15;
    return `${String(hours).padStart(2, "0")}:${String(minutes).padStart(2, "0")}`;
  });
  assert.deepEqual(options.map((option) => option.dataset.time), expectedTimes);
  assert.ok(options.every((option) => option.type === "button"));
  assert.ok(options.every((option) => option.tabIndex === -1));
  assert.equal(
    options.find((option) => option.getAttribute("aria-selected") === "true")?.dataset.time,
    "09:15",
  );

  keyDown(trigger, "ArrowDown");
  assert.match(displayedTime.textContent ?? "", /9:15/);
  const enterEvent = keyDown(trigger, "Enter");
  assert.equal(enterEvent.defaultPrevented, true);
  assert.equal(trigger.getAttribute("aria-expanded"), "false");
  assert.equal(container.querySelector('[role="listbox"]'), null);
  assert.match(displayedTime.textContent ?? "", /9:30/);
  assert.equal(document.activeElement, trigger);
  assert.equal(Boolean(saved), false);

  const taskNameInput = requireElement<HTMLInputElement>(container, 'input[placeholder="What needs to be done?"]');
  act(() => taskNameInput.focus());
  click(control);
  assert.equal(trigger.getAttribute("aria-expanded"), "true");
  assert.equal(document.activeElement, trigger);
  keyDown(document.activeElement, "Escape");
  await act(async () => {
    requireElement<HTMLFormElement>(container, "form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
  });
  assert.equal(saved?.time, "09:30");
});

test("time menu Escape, outside press, pointer selection, and Clear have intentional behavior", () => {
  let closeCount = 0;
  let saveCount = 0;
  const container = render(
    <TaskEditor
      experiments={[experimentAlpha]}
      initialDate="2026-08-01"
      initialExperimentId={experimentAlpha.id}
      onClose={() => { closeCount += 1; }}
      onSave={async () => { saveCount += 1; }}
      task={makeTask("Timed task", { time: "09:15" })}
    />,
  );
  const trigger = requireElement<HTMLButtonElement>(container, '[role="combobox"]');
  const displayedTime = requireElement(container, ".time-picker-control__value");

  click(trigger);
  keyDown(trigger, "ArrowDown");
  const escapeEvent = keyDown(trigger, "Escape");
  assert.equal(escapeEvent.defaultPrevented, true);
  assert.equal(container.querySelector('[role="listbox"]'), null);
  assert.match(displayedTime.textContent ?? "", /9:15/);
  assert.equal(document.activeElement, trigger);
  assert.equal(closeCount, 0);

  keyDown(trigger, "Escape");
  assert.equal(closeCount, 1);

  click(trigger);
  const taskNameInput = requireElement<HTMLInputElement>(container, 'input[placeholder="What needs to be done?"]');
  mouseDown(taskNameInput);
  act(() => taskNameInput.focus());
  assert.equal(container.querySelector('[role="listbox"]'), null);
  assert.equal(document.activeElement, taskNameInput);
  assert.match(displayedTime.textContent ?? "", /9:15/);

  click(trigger);
  click(requireElement(container, '[role="option"][data-time="10:30"]'));
  assert.equal(container.querySelector('[role="listbox"]'), null);
  assert.match(displayedTime.textContent ?? "", /10:30/);
  assert.equal(document.activeElement, trigger);
  assert.equal(saveCount, 0);

  click(requireElement(container, ".time-picker-control__clear"));
  assert.equal(displayedTime.textContent, "No time");
  assert.equal(container.querySelector('[role="listbox"]'), null);
  assert.equal(document.activeElement, trigger);
  assert.equal(saveCount, 0);
});

async function submitTaskEditor(
  task: Task | undefined,
  nextTime: string,
): Promise<TaskInput | undefined> {
  let saved: TaskInput | undefined;
  const container = render(
    <TaskEditor
      experiments={[experimentAlpha]}
      initialDate="2026-08-01"
      initialExperimentId={experimentAlpha.id}
      onClose={() => undefined}
      onSave={async (input) => { saved = input; }}
      task={task}
    />,
  );
  const trigger = requireElement<HTMLButtonElement>(container, '[role="combobox"]');
  if (nextTime) {
    click(trigger);
    click(requireElement(container, `[role="option"][data-time="${nextTime}"]`));
  } else if (task?.time) {
    click(requireElement(container, ".time-picker-control__clear"));
  }
  await act(async () => {
    requireElement<HTMLFormElement>(container, "form").dispatchEvent(
      new Event("submit", { bubbles: true, cancelable: true }),
    );
    await Promise.resolve();
  });
  return saved;
}

test("task editor adds or changes a quarter-hour time", async () => {
  const saved = await submitTaskEditor(makeTask("Editable", { time: "09:15" }), "10:30");
  assert.equal(saved?.time, "10:30");
});

test("task editor removes an existing time without changing legacy task fields", async () => {
  const task = makeTask("Untime me", { time: "09:15", notes: "Keep these notes" });
  const saved = await submitTaskEditor(task, "");
  assert.equal(saved?.time, null);
  assert.equal(saved?.name, task.name);
  assert.equal(saved?.notes, task.notes);
  assert.equal(saved?.experimentId, task.experimentId);
});
