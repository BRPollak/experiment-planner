import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, test } from "node:test";
import { act, useState, type ReactElement } from "react";
import type { Root } from "react-dom/client";
import { JSDOM } from "jsdom";

import type { Experiment, Task } from "../../shared/models";
import { getWeekRange, toDateKey } from "../lib/dates";
import type { CalendarView } from "./CalendarToolbar";
import { CalendarWorkspace } from "./CalendarWorkspace";
import { WeekCalendar } from "./WeekCalendar";

const experimentAlpha: Experiment = {
  id: "alpha",
  name: "Alpha experiment",
  color: "#2563EB",
  description: null,
  archived: false,
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
    date: "2026-08-19",
    time: null,
    completed: false,
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

// React DOM performs capability detection at import time, so bootstrap it with
// a document before replacing that document for each test.
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

function requireElement<TElement extends Element>(
  root: ParentNode,
  selector: string,
): TElement {
  const element = root.querySelector<TElement>(selector);
  assert.ok(element, `Expected ${selector}`);
  return element;
}

function buttonName(button: HTMLButtonElement): string {
  return button.getAttribute("aria-label") ?? button.textContent?.trim() ?? "";
}

function requireButton(root: ParentNode, name: string): HTMLButtonElement {
  const button = [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((candidate) => buttonName(candidate) === name);
  assert.ok(button, `Expected button named \"${name}\"`);
  return button;
}

function requireRowContaining(
  root: ParentNode,
  selector: string,
  text: string,
): HTMLElement {
  const row = [...root.querySelectorAll<HTMLElement>(selector)]
    .find((candidate) => candidate.textContent?.includes(text));
  assert.ok(row, `Expected ${selector} containing \"${text}\"`);
  return row;
}

interface CalendarHarnessProps {
  initialDate?: Date;
  initialTasks?: Task[];
  selectedExperimentId?: string | null;
}

function CalendarHarness({
  initialDate = new Date(2026, 7, 19),
  initialTasks = [],
  selectedExperimentId = null,
}: CalendarHarnessProps) {
  const [view, setView] = useState<CalendarView>("month");
  const [date, setDate] = useState(initialDate);
  const [tasks, setTasks] = useState(initialTasks);
  const visibleTasks = selectedExperimentId
    ? tasks.filter((task) => task.experimentId === selectedExperimentId)
    : tasks;
  const toggleCompletion = (task: Task, completed: boolean) => {
    setTasks((current) => current.map((candidate) => (
      candidate.id === task.id ? { ...candidate, completed } : candidate
    )));
  };
  const shared = {
    completingTaskIds: new Set<string>(),
    experiments: [experimentAlpha, experimentBeta],
    hasCalendar: true,
    loading: false,
    movingTaskIds: new Set<string>(),
    onCreateCalendar: () => undefined,
    onCreateExperiment: () => undefined,
    onCreateTask: () => undefined,
    onEditTask: () => undefined,
    onOpenDay: () => undefined,
    onToggleTaskCompletion: toggleCompletion,
    onViewChange: setView,
    selectedCalendarName: "Calendar",
    selectedExperimentId,
    tasks: visibleTasks,
    view,
  };

  return (
    <CalendarWorkspace
      {...shared}
      date={date}
      onDateChange={setDate}
      onMoveTask={() => undefined}
    />
  );
}

interface WeekSpies {
  created: string[];
  dates: Date[];
  edited: string[];
  opened: string[];
  toggled: Array<[string, boolean]>;
  views: CalendarView[];
}

function renderWeek(
  tasks: Task[] = [],
  date = new Date(2026, 7, 19),
): { container: HTMLElement; spies: WeekSpies } {
  const spies: WeekSpies = {
    created: [],
    dates: [],
    edited: [],
    opened: [],
    toggled: [],
    views: [],
  };
  const container = render(
    <WeekCalendar
      date={date}
      experiments={[experimentAlpha, experimentBeta]}
      hasCalendar
      loading={false}
      onCreateCalendar={() => undefined}
      onCreateExperiment={() => undefined}
      onCreateTask={(taskDate) => spies.created.push(taskDate)}
      onDateChange={(nextDate) => spies.dates.push(nextDate)}
      onEditTask={(task) => spies.edited.push(task.id)}
      onOpenDay={(day) => spies.opened.push(day)}
      onToggleTaskCompletion={(task, completed) => spies.toggled.push([task.id, completed])}
      onViewChange={(view) => spies.views.push(view)}
      selectedCalendarName="Calendar"
      selectedExperimentId={null}
      tasks={tasks}
      view="week"
    />,
  );
  return { container, spies };
}

test("Month and Week switch without losing the shared cross-month reference or filter", () => {
  const alphaTask = makeTask("Visible alpha", { date: "2026-08-31" });
  const betaTask = makeTask("Filtered beta", {
    date: "2026-08-31",
    experimentId: experimentBeta.id,
  });
  const container = render(
    <CalendarHarness
      initialDate={new Date(2026, 7, 31)}
      initialTasks={[alphaTask, betaTask]}
      selectedExperimentId={experimentAlpha.id}
    />,
  );

  const monthButton = requireButton(container, "Month");
  const weekButton = requireButton(container, "Week");
  const switcher = requireElement(container, ".calendar-view-switcher");
  assert.equal(monthButton.getAttribute("aria-pressed"), "true");
  assert.equal(weekButton.getAttribute("aria-pressed"), "false");
  assert.match(container.textContent ?? "", /August 2026/);
  assert.match(container.textContent ?? "", /Visible alpha/);
  assert.doesNotMatch(container.textContent ?? "", /Filtered beta/);

  click(weekButton);

  assert.equal(requireButton(container, "Month").getAttribute("aria-pressed"), "false");
  assert.equal(requireButton(container, "Week").getAttribute("aria-pressed"), "true");
  assert.equal(
    requireElement(container, ".calendar-view-switcher").getAttribute("data-view"),
    "week",
  );
  assert.equal(requireElement(container, ".calendar-view-switcher"), switcher);
  assert.equal(
    requireElement(container, ".calendar-toolbar__title h2").textContent,
    "August – September 2026",
  );
  assert.ok(container.querySelector('[data-date-key="2026-08-31"]'));
  assert.match(container.textContent ?? "", /Calendar · Alpha experiment/);
  assert.match(container.textContent ?? "", /Visible alpha/);
  assert.doesNotMatch(container.textContent ?? "", /Filtered beta/);

  click(requireButton(container, "Next week"));
  assert.equal(
    requireElement(container, ".calendar-toolbar__title h2").textContent,
    "September 2026",
  );
  assert.ok(container.querySelector('[data-date-key="2026-09-07"]'));

  click(requireButton(container, "Month"));
  assert.equal(requireButton(container, "Month").getAttribute("aria-pressed"), "true");
  assert.equal(requireElement(container, ".calendar-toolbar__title h2").textContent, "September 2026");
  assert.ok(container.querySelector('[data-date-key="2026-09-07"]'));
  assert.match(container.textContent ?? "", /Calendar · Alpha experiment/);
});

test("Week renders exactly seven chronological configured day columns and date headers", () => {
  const { container } = renderWeek();
  const row = requireElement<HTMLElement>(container, ".week-grid > .week-grid__row");
  const columns = [...row.querySelectorAll<HTMLElement>(":scope > .week-day")];

  assert.equal(row.getAttribute("role"), "row");
  assert.equal(columns.length, 7);
  assert.deepEqual(columns.map((column) => column.getAttribute("role")), Array(7).fill("gridcell"));
  assert.deepEqual(columns.map((column) => column.dataset.weekday), ["0", "1", "2", "3", "4", "5", "6"]);
  assert.deepEqual(columns.map((column) => column.dataset.dateKey), [
    "2026-08-16",
    "2026-08-17",
    "2026-08-18",
    "2026-08-19",
    "2026-08-20",
    "2026-08-21",
    "2026-08-22",
  ]);
  assert.deepEqual(
    columns.map((column) => requireElement(column, ".week-day__weekday").textContent),
    ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"],
  );
  assert.deepEqual(
    columns.map((column) => requireElement<HTMLTimeElement>(column, ".week-day__date").dateTime),
    columns.map((column) => column.dataset.dateKey),
  );
  assert.deepEqual(
    columns.map((column) => requireElement(column, ".week-day__date").textContent?.trim()),
    ["16", "17", "18", "19", "20", "21", "22"],
  );
  assert.equal(columns[0].classList.contains("is-weekend"), true);
  assert.equal(columns[1].classList.contains("is-weekend"), false);
  assert.equal(columns[6].classList.contains("is-weekend"), true);
});

test("Week previous, next, and Today navigation retain the weekday reference", () => {
  function NavigationHarness() {
    const [date, setDate] = useState(new Date(2026, 7, 19));
    return (
      <WeekCalendar
        date={date}
        experiments={[experimentAlpha]}
        hasCalendar
        loading={false}
        onCreateCalendar={() => undefined}
        onCreateExperiment={() => undefined}
        onCreateTask={() => undefined}
        onDateChange={setDate}
        onEditTask={() => undefined}
        onOpenDay={() => undefined}
        onToggleTaskCompletion={() => undefined}
        onViewChange={() => undefined}
        selectedCalendarName="Calendar"
        selectedExperimentId={null}
        tasks={[]}
        view="week"
      />
    );
  }

  const container = render(<NavigationHarness />);
  const visibleDates = () => [...container.querySelectorAll<HTMLElement>(".week-day")]
    .map((column) => column.dataset.dateKey);

  click(requireButton(container, "Previous week"));
  assert.deepEqual(visibleDates(), [
    "2026-08-09",
    "2026-08-10",
    "2026-08-11",
    "2026-08-12",
    "2026-08-13",
    "2026-08-14",
    "2026-08-15",
  ]);

  click(requireButton(container, "Next week"));
  assert.deepEqual(visibleDates(), [
    "2026-08-16",
    "2026-08-17",
    "2026-08-18",
    "2026-08-19",
    "2026-08-20",
    "2026-08-21",
    "2026-08-22",
  ]);
  click(requireButton(container, "Next week"));
  assert.deepEqual(visibleDates(), [
    "2026-08-23",
    "2026-08-24",
    "2026-08-25",
    "2026-08-26",
    "2026-08-27",
    "2026-08-28",
    "2026-08-29",
  ]);

  click(requireButton(container, "Today"));
  assert.deepEqual(
    visibleDates(),
    getWeekRange(new Date()).days.map((day) => day.dateKey),
  );
});

test("Week toolbar renders one-month, cross-month, and cross-year range headings", () => {
  const cases: Array<[Date, string]> = [
    [new Date(2026, 7, 19), "August 2026"],
    [new Date(2026, 7, 31), "August – September 2026"],
    [new Date(2026, 11, 30), "December 2026 – January 2027"],
  ];

  for (const [date, expected] of cases) {
    const { container } = renderWeek([], date);
    assert.equal(requireElement(container, ".calendar-toolbar__title h2").textContent, expected);
  }
});

test("Week days reuse Day ordering, grouping, metadata, colors, and task interactions", () => {
  const tasks = [
    makeTask("Alpha later", {
      time: "11:00",
      notes: "   ",
      createdAt: "2026-01-01T11:00:00.000Z",
    }),
    makeTask("Other day", { date: "2026-08-20", time: "07:00" }),
    makeTask("Unknown experiment", {
      experimentId: "missing",
      time: "09:00",
      createdAt: "2026-01-01T09:00:00.000Z",
    }),
    makeTask("Beta first", {
      experimentId: experimentBeta.id,
      time: "08:00",
      createdAt: "2026-01-01T08:00:00.000Z",
    }),
    makeTask("Alpha notes", {
      time: "10:00",
      notes: "First line\nSecond line",
      createdAt: "2026-01-01T10:00:00.000Z",
    }),
  ];
  const { container, spies } = renderWeek(tasks);
  const day = requireElement<HTMLElement>(container, '[data-date-key="2026-08-19"]');

  assert.deepEqual(
    [...day.querySelectorAll(".day-view__group-header h3")].map((node) => node.textContent),
    ["Beta experiment", "No experiment", "Alpha experiment"],
  );
  assert.deepEqual(
    [...day.querySelectorAll(".day-view__task-name")].map((node) => node.textContent),
    ["Beta first", "Unknown experiment", "Alpha notes", "Alpha later"],
  );
  assert.deepEqual(
    [...day.querySelectorAll<HTMLTimeElement>(".day-view__task-time")]
      .map((time) => time.dateTime),
    ["08:00", "09:00", "10:00", "11:00"],
  );
  assert.equal(day.querySelectorAll(".day-view__task-notes").length, 1);
  assert.match(requireElement(day, ".day-view__task-notes").textContent ?? "", /First line\s*Second line/);
  assert.doesNotMatch(day.textContent ?? "", /Other day/);

  const betaGroup = requireElement<HTMLElement>(day, '[aria-label="Beta experiment tasks"]');
  const alphaGroup = requireElement<HTMLElement>(day, '[aria-label="Alpha experiment tasks"]');
  const fallbackGroup = requireElement<HTMLElement>(day, '[aria-label="No experiment tasks"]');
  assert.equal(betaGroup.style.getPropertyValue("--experiment-color"), experimentBeta.color);
  assert.equal(alphaGroup.style.getPropertyValue("--experiment-color"), experimentAlpha.color);
  assert.equal(fallbackGroup.style.getPropertyValue("--experiment-color"), "#64748b");

  const alphaNotesRow = requireRowContaining(day, ".day-view__task-row", "Alpha notes");
  click(requireElement(alphaNotesRow, ".day-view__task"));
  const betaRow = requireRowContaining(day, ".day-view__task-row", "Beta first");
  click(requireElement(betaRow, '.day-view__task-checkbox[role="checkbox"]'));
  click(requireElement(day, ".week-day__open"));
  click(requireElement(day, ".week-day__add-task"));

  assert.deepEqual(spies.edited, ["Alpha notes"]);
  assert.deepEqual(spies.toggled, [["Beta first", true]]);
  assert.deepEqual(spies.opened, ["2026-08-19"]);
  assert.deepEqual(spies.created, ["2026-08-19"]);
});

test("completion state stays synchronized while switching between Month and Week", () => {
  const active = makeTask("Shared task", { time: "09:00" });
  const container = render(
    <CalendarHarness initialDate={new Date(2026, 7, 19)} initialTasks={[active]} />,
  );

  let monthRow = requireRowContaining(
    requireElement(container, '[data-date-key="2026-08-19"]'),
    ".calendar-task-row",
    active.name,
  );
  let checkbox = requireElement<HTMLButtonElement>(
    monthRow,
    '.calendar-task__checkbox[role="checkbox"]',
  );
  assert.equal(checkbox.getAttribute("aria-checked"), "false");
  click(checkbox);

  monthRow = requireRowContaining(
    requireElement(container, '[data-date-key="2026-08-19"]'),
    ".calendar-task-row",
    active.name,
  );
  assert.equal(
    requireElement(monthRow, '.calendar-task__checkbox[role="checkbox"]')
      .getAttribute("aria-checked"),
    "true",
  );
  assert.ok(requireElement(monthRow, ".calendar-task").classList.contains("is-completed"));

  click(requireButton(container, "Week"));
  let weekRow = requireRowContaining(
    requireElement(container, '[data-date-key="2026-08-19"]'),
    ".day-view__task-row",
    active.name,
  );
  checkbox = requireElement<HTMLButtonElement>(
    weekRow,
    '.day-view__task-checkbox[role="checkbox"]',
  );
  assert.equal(checkbox.getAttribute("aria-checked"), "true");
  assert.ok(requireElement(weekRow, ".day-view__task").classList.contains("is-completed"));
  click(checkbox);

  weekRow = requireRowContaining(
    requireElement(container, '[data-date-key="2026-08-19"]'),
    ".day-view__task-row",
    active.name,
  );
  assert.equal(
    requireElement(weekRow, '.day-view__task-checkbox[role="checkbox"]')
      .getAttribute("aria-checked"),
    "false",
  );

  click(requireButton(container, "Month"));
  monthRow = requireRowContaining(
    requireElement(container, '[data-date-key="2026-08-19"]'),
    ".calendar-task-row",
    active.name,
  );
  assert.equal(
    requireElement(monthRow, '.calendar-task__checkbox[role="checkbox"]')
      .getAttribute("aria-checked"),
    "false",
  );
  assert.equal(requireElement(monthRow, ".calendar-task").classList.contains("is-completed"), false);
});

test("the top-right Add Task button is gone while dated creation controls remain", () => {
  const created: string[] = [];
  const container = render(
    <CalendarWorkspace
      date={new Date(2026, 7, 19)}
      experiments={[experimentAlpha]}
      hasCalendar
      loading={false}
      movingTaskIds={new Set()}
      onCreateCalendar={() => undefined}
      onCreateExperiment={() => undefined}
      onCreateTask={(date) => created.push(date)}
      onDateChange={() => undefined}
      onEditTask={() => undefined}
      onMoveTask={() => undefined}
      onOpenDay={() => undefined}
      onToggleTaskCompletion={() => undefined}
      onViewChange={() => undefined}
      selectedCalendarName="Calendar"
      selectedExperimentId={null}
      tasks={[]}
      view="month"
    />,
  );
  const toolbar = requireElement<HTMLElement>(container, ".calendar-toolbar");

  assert.equal(toolbar.querySelector(".add-task-button"), null);
  assert.equal(
    [...toolbar.querySelectorAll<HTMLButtonElement>("button")]
      .some((button) => /^add task$/i.test(buttonName(button))),
    false,
  );
  assert.ok(toolbar.lastElementChild?.classList.contains("calendar-view-switcher"));
  assert.deepEqual(
    [...requireElement(toolbar, ".calendar-view-switcher")
      .querySelectorAll<HTMLButtonElement>("button")]
      .map((button) => button.textContent?.trim()),
    ["Month", "Week"],
  );

  const day = requireElement<HTMLElement>(container, '[data-date-key="2026-08-19"]');
  const datedAddButton = requireElement<HTMLButtonElement>(day, ".calendar-day__add-task");
  assert.match(datedAddButton.getAttribute("aria-label") ?? "", /^Add task on /);
  click(datedAddButton);
  assert.deepEqual(created, ["2026-08-19"]);
});

test("the current week day uses the Month current-day semantics", () => {
  const now = new Date();
  const todayKey = toDateKey(now);
  const { container } = renderWeek([], now);
  const today = requireElement<HTMLElement>(container, `[data-date-key="${todayKey}"]`);

  assert.ok(today.classList.contains("is-today"));
  assert.equal(requireElement(today, ".week-day__open").getAttribute("aria-current"), "date");
  assert.match(today.textContent ?? "", /Today/);
});

test("Week overflow, sticky headers, segment motion, and reduced-motion rules are present", () => {
  const css = readFileSync(new URL("../styles.css", import.meta.url), "utf8");

  assert.match(css, /\.week-calendar-scroll\s*\{[^}]*overflow:\s*auto;/s);
  assert.match(css, /\.week-grid\s*\{[^}]*display:\s*grid;[^}]*min-width:\s*\d+px;/s);
  assert.match(css, /\.week-grid__row\s*\{[^}]*grid-template-columns:\s*repeat\(7,\s*minmax\(\d+px,\s*1fr\)\);/s);
  assert.match(css, /\.week-day__header\s*\{[^}]*position:\s*sticky;[^}]*top:\s*0;/s);
  assert.match(css, /\.calendar-view-switcher::before\s*\{[^}]*transition:\s*transform\s+\d+ms/s);
  assert.match(css, /\.calendar-view-switcher\[data-view="week"\]::before\s*\{[^}]*transform:\s*translateX\(100%\);/s);
  assert.match(
    css,
    /@media \(prefers-reduced-motion:\s*reduce\)\s*\{[\s\S]*transition-duration:\s*0\.01ms\s*!important;/,
  );
});
