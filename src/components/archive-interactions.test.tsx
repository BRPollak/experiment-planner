import assert from "node:assert/strict";
import { afterEach, beforeEach, test } from "node:test";
import { act, type ReactElement } from "react";
import type { Root } from "react-dom/client";
import { JSDOM } from "jsdom";

import type { Experiment, Task } from "../../shared/models";
import type { PlannerCalendar } from "../lib/types";
import { CalendarEditor } from "./CalendarEditor";
import { ExperimentEditor } from "./ExperimentEditor";
import { ExperimentSidebar } from "./ExperimentSidebar";
import { TaskEditor } from "./TaskEditor";

type ArchivableCalendar = PlannerCalendar & { archived: boolean };
type ArchivableExperiment = Experiment & { archived: boolean };

const activeCalendar: ArchivableCalendar = {
  id: "active-calendar",
  name: "Active calendar",
  archived: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  experimentCount: 1,
  taskCount: 2,
};

const archivedCalendar: ArchivableCalendar = {
  ...activeCalendar,
  id: "archived-calendar",
  name: "Archived calendar",
  archived: true,
};

const activeExperiment: ArchivableExperiment = {
  id: "active-experiment",
  name: "Active experiment",
  color: "#2563eb",
  description: null,
  calendarId: activeCalendar.id,
  archived: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  taskCount: 1,
};

const archivedExperiment: ArchivableExperiment = {
  ...activeExperiment,
  id: "archived-experiment",
  name: "Archived experiment",
  archived: true,
};

const task: Task = {
  id: "task",
  name: "Directly deletable task",
  date: "2026-08-16",
  time: null,
  experimentId: activeExperiment.id,
  notes: null,
  completed: false,
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const exposedGlobalNames = [
  "window",
  "document",
  "navigator",
  "Node",
  "HTMLElement",
  "HTMLButtonElement",
  "HTMLInputElement",
  "HTMLSelectElement",
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
    HTMLSelectElement: nextDom.window.HTMLSelectElement,
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

async function clickAndFlush(element: Element): Promise<void> {
  await act(async () => {
    element.dispatchEvent(new MouseEvent("click", { bubbles: true, cancelable: true }));
    await Promise.resolve();
  });
}

function changeSelect(select: HTMLSelectElement, value: string): void {
  act(() => {
    select.value = value;
    select.dispatchEvent(new Event("change", { bubbles: true, cancelable: true }));
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

function findButton(root: ParentNode, name: string): HTMLButtonElement | undefined {
  return [...root.querySelectorAll<HTMLButtonElement>("button")]
    .find((button) => buttonName(button) === name);
}

function requireButton(root: ParentNode, name: string): HTMLButtonElement {
  const button = findButton(root, name);
  assert.ok(button, `Expected button named \"${name}\"`);
  return button;
}

function requireLabelledGroup(root: ParentNode, name: string): HTMLElement {
  const direct = [...root.querySelectorAll<HTMLElement>('[role="group"]')]
    .find((group) => {
      if (group.getAttribute("aria-label") === name) return true;
      const labelledBy = group.getAttribute("aria-labelledby");
      return labelledBy ? document.getElementById(labelledBy)?.textContent?.trim() === name : false;
    });
  assert.ok(direct, `Expected group named \"${name}\"`);
  return direct;
}

interface SidebarSpies {
  archivedCalendars: string[];
  deletedCalendars: string[];
  editedExperiments: string[];
  selectedCalendars: string[];
  selectedExperiments: Array<string | null>;
  unarchivedCalendars: string[];
}

function renderSidebar(selectedCalendarId: string): {
  container: HTMLElement;
  spies: SidebarSpies;
} {
  const spies: SidebarSpies = {
    archivedCalendars: [],
    deletedCalendars: [],
    editedExperiments: [],
    selectedCalendars: [],
    selectedExperiments: [],
    unarchivedCalendars: [],
  };
  const archiveProps = {
    onArchiveCalendar: async (calendar: PlannerCalendar) => {
      spies.archivedCalendars.push(calendar.id);
    },
    onUnarchiveCalendar: async (calendar: PlannerCalendar) => {
      spies.unarchivedCalendars.push(calendar.id);
    },
  };
  const container = render(
    <ExperimentSidebar
      calendars={[activeCalendar, archivedCalendar]}
      calendarsLoading={false}
      experiments={[activeExperiment, archivedExperiment]}
      loading={false}
      onCreate={() => undefined}
      onCreateCalendar={() => undefined}
      onDeleteCalendar={(calendar) => spies.deletedCalendars.push(calendar.id)}
      onEdit={(experiment) => spies.editedExperiments.push(experiment.id)}
      onEditCalendar={() => undefined}
      onSelect={(id) => spies.selectedExperiments.push(id)}
      onSelectCalendar={(id) => spies.selectedCalendars.push(id)}
      selectedCalendarId={selectedCalendarId}
      selectedExperimentId={null}
      {...archiveProps}
    />,
  );
  return { container, spies };
}

test("calendar switcher groups active and archived calendars", () => {
  const { container, spies } = renderSidebar(activeCalendar.id);
  const select = requireElement<HTMLSelectElement>(container, 'select[aria-label="Selected calendar"]');
  const groups = [...select.querySelectorAll("optgroup")];

  assert.deepEqual(groups.map((group) => group.label), ["Active calendars", "Archived calendars"]);
  assert.deepEqual(
    [...groups[0].querySelectorAll("option")].map((option) => [option.value, option.textContent]),
    [[activeCalendar.id, activeCalendar.name]],
  );
  assert.deepEqual(
    [...groups[1].querySelectorAll("option")].map((option) => [option.value, option.textContent]),
    [[archivedCalendar.id, archivedCalendar.name]],
  );

  changeSelect(select, archivedCalendar.id);
  assert.deepEqual(spies.selectedCalendars, [archivedCalendar.id]);
});

test("active calendar exposes archive but not permanent delete or unarchive", () => {
  const { container, spies } = renderSidebar(activeCalendar.id);

  click(requireButton(container, `Archive ${activeCalendar.name}`));

  assert.deepEqual(spies.archivedCalendars, [activeCalendar.id]);
  assert.equal(findButton(container, `Delete ${activeCalendar.name}`), undefined);
  assert.equal(findButton(container, `Unarchive ${activeCalendar.name}`), undefined);
});

test("archived calendar exposes unarchive and permanent delete but not archive", () => {
  const { container, spies } = renderSidebar(archivedCalendar.id);

  click(requireButton(container, `Unarchive ${archivedCalendar.name}`));
  click(requireButton(container, `Delete ${archivedCalendar.name}`));

  assert.deepEqual(spies.unarchivedCalendars, [archivedCalendar.id]);
  assert.deepEqual(spies.deletedCalendars, [archivedCalendar.id]);
  assert.equal(findButton(container, `Archive ${archivedCalendar.name}`), undefined);
});

test("experiment navigation separates active and archived experiments", () => {
  const { container, spies } = renderSidebar(activeCalendar.id);
  const activeGroup = requireLabelledGroup(container, "Active experiments");
  const archivedGroup = requireLabelledGroup(container, "Archived experiments");

  assert.match(activeGroup.textContent ?? "", /Active experiment/);
  assert.doesNotMatch(activeGroup.textContent ?? "", /Archived experiment/);
  assert.match(archivedGroup.textContent ?? "", /Archived experiment/);
  assert.doesNotMatch(archivedGroup.textContent ?? "", /Active experiment/);

  click(requireButton(activeGroup, `Edit ${activeExperiment.name}`));
  click(requireButton(archivedGroup, `Edit ${archivedExperiment.name}`));
  assert.deepEqual(spies.editedExperiments, [activeExperiment.id, archivedExperiment.id]);
});

test("active calendar editor offers archive instead of delete", async () => {
  let archiveCount = 0;
  let deleteCount = 0;
  const archiveProps = {
    onArchive: async () => { archiveCount += 1; },
    onUnarchive: async () => undefined,
  };
  const container = render(
    <CalendarEditor
      calendar={activeCalendar}
      onClose={() => undefined}
      onRequestDelete={() => { deleteCount += 1; }}
      onSave={async () => undefined}
      {...archiveProps}
    />,
  );

  await clickAndFlush(requireButton(container, "Archive calendar"));
  assert.equal(archiveCount, 1);
  assert.equal(deleteCount, 0);
  assert.equal(findButton(container, "Delete calendar"), undefined);
  assert.equal(findButton(container, "Unarchive calendar"), undefined);
});

test("archived calendar editor offers unarchive and permanent delete", async () => {
  let unarchiveCount = 0;
  let deleteCount = 0;
  const archiveProps = {
    onArchive: async () => undefined,
    onUnarchive: async () => { unarchiveCount += 1; },
  };
  const container = render(
    <CalendarEditor
      calendar={archivedCalendar}
      onClose={() => undefined}
      onRequestDelete={() => { deleteCount += 1; }}
      onSave={async () => undefined}
      {...archiveProps}
    />,
  );

  await clickAndFlush(requireButton(container, "Unarchive calendar"));
  click(requireButton(container, "Delete calendar"));
  assert.equal(unarchiveCount, 1);
  assert.equal(deleteCount, 1);
  assert.equal(findButton(container, "Archive calendar"), undefined);
});

test("active experiment editor offers archive instead of delete", async () => {
  let archiveCount = 0;
  let deleteCount = 0;
  const archiveProps = {
    onArchive: async () => { archiveCount += 1; },
    onUnarchive: async () => undefined,
  };
  const container = render(
    <ExperimentEditor
      experiment={activeExperiment}
      onClose={() => undefined}
      onRequestDelete={() => { deleteCount += 1; }}
      onSave={async () => undefined}
      {...archiveProps}
    />,
  );

  await clickAndFlush(requireButton(container, "Archive experiment"));
  assert.equal(archiveCount, 1);
  assert.equal(deleteCount, 0);
  assert.equal(findButton(container, "Delete experiment"), undefined);
  assert.equal(findButton(container, "Unarchive experiment"), undefined);
});

test("archived experiment editor offers unarchive and permanent delete", async () => {
  let unarchiveCount = 0;
  let deleteCount = 0;
  const archiveProps = {
    onArchive: async () => undefined,
    onUnarchive: async () => { unarchiveCount += 1; },
  };
  const container = render(
    <ExperimentEditor
      experiment={archivedExperiment}
      onClose={() => undefined}
      onRequestDelete={() => { deleteCount += 1; }}
      onSave={async () => undefined}
      {...archiveProps}
    />,
  );

  await clickAndFlush(requireButton(container, "Unarchive experiment"));
  click(requireButton(container, "Delete experiment"));
  assert.equal(unarchiveCount, 1);
  assert.equal(deleteCount, 1);
  assert.equal(findButton(container, "Archive experiment"), undefined);
});

test("task editor retains direct deletion without archive actions", () => {
  let deleteCount = 0;
  const container = render(
    <TaskEditor
      experiments={[activeExperiment, archivedExperiment]}
      initialDate={task.date}
      onClose={() => undefined}
      onRequestDelete={() => { deleteCount += 1; }}
      onSave={async () => undefined}
      task={task}
    />,
  );

  click(requireButton(container, "Delete task"));
  assert.equal(deleteCount, 1);
  assert.equal(findButton(container, "Archive task"), undefined);
  assert.equal(findButton(container, "Unarchive task"), undefined);
});
