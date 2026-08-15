import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { test } from "node:test";

import type { ApiErrorBody } from "../shared/models";
import { createApplication } from "./app";
import { ExperimentPlannerDatabase } from "./database";

interface TestApplication {
  baseUrl: string;
  database: ExperimentPlannerDatabase;
  directory: string;
  server: Server;
}

async function startTestApplication(): Promise<TestApplication> {
  const directory = mkdtempSync(join(tmpdir(), "experiment-planner-api-test-"));
  const database = new ExperimentPlannerDatabase(join(directory, "planner.sqlite"));
  const server = createServer(createApplication({ database }));
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", reject);
      resolve();
    });
  });
  const address = server.address() as AddressInfo;
  return {
    baseUrl: `http://127.0.0.1:${address.port}`,
    database,
    directory,
    server,
  };
}

async function stopTestApplication(application: TestApplication): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    application.server.close((error) => (error ? reject(error) : resolve()));
  });
  application.database.close();
  rmSync(application.directory, { recursive: true, force: true });
}

async function readError(response: Response): Promise<ApiErrorBody> {
  return (await response.json()) as ApiErrorBody;
}

test("experiment deletion rejects missing, invalid, and stale count confirmations", async () => {
  const application = await startTestApplication();
  try {
    const calendar = application.database.createCalendar({ name: "API calendar" });
    const experiment = application.database.createExperiment({
      name: "Protected experiment",
      color: "#123456",
      calendarId: calendar.id,
    });
    application.database.createTask({
      name: "First task",
      date: "2026-08-14",
      experimentId: experiment.id,
    });

    const initial = await fetch(
      `${application.baseUrl}/api/experiments/${experiment.id}`,
      { method: "DELETE" },
    );
    assert.equal(initial.status, 409);
    assert.deepEqual(await readError(initial), {
      error: "This experiment contains 1 task. Confirm deletion to also delete its tasks.",
      code: "EXPERIMENT_HAS_TASKS",
      details: {
        taskCount: 1,
        confirmationRequired: true,
        countsChanged: false,
      },
    });

    const missingCount = await fetch(
      `${application.baseUrl}/api/experiments/${experiment.id}?confirmCascade=true`,
      { method: "DELETE" },
    );
    assert.equal(missingCount.status, 409);
    assert.equal((await readError(missingCount)).code, "EXPERIMENT_CONTENT_CHANGED");
    assert.ok(application.database.getExperiment(experiment.id));

    for (const invalidCount of ["-1", "1.0", "01", "9007199254740992"]) {
      const invalid = await fetch(
        `${application.baseUrl}/api/experiments/${experiment.id}?confirmCascade=true&expectedTaskCount=${invalidCount}`,
        { method: "DELETE" },
      );
      assert.equal(invalid.status, 400);
      assert.equal((await readError(invalid)).code, "VALIDATION_ERROR");
    }

    application.database.createTask({
      name: "Added after the prompt",
      date: "2026-08-15",
      experimentId: experiment.id,
    });
    const stale = await fetch(
      `${application.baseUrl}/api/experiments/${experiment.id}?confirmCascade=true&expectedTaskCount=1`,
      { method: "DELETE" },
    );
    assert.equal(stale.status, 409);
    assert.deepEqual((await readError(stale)).details, {
      taskCount: 2,
      confirmationRequired: true,
      countsChanged: true,
    });
    assert.ok(application.database.getExperiment(experiment.id));

    const confirmed = await fetch(
      `${application.baseUrl}/api/experiments/${experiment.id}?confirmCascade=true&expectedTaskCount=2`,
      { method: "DELETE" },
    );
    assert.equal(confirmed.status, 204);
    assert.equal(application.database.getExperiment(experiment.id), null);
  } finally {
    await stopTestApplication(application);
  }
});

test("calendar deletion atomically checks both displayed content counts", async () => {
  const application = await startTestApplication();
  try {
    const calendar = application.database.createCalendar({ name: "Protected calendar" });
    const experiment = application.database.createExperiment({
      name: "First experiment",
      color: "#654321",
      calendarId: calendar.id,
    });
    application.database.createTask({
      name: "Calendar task",
      date: "2026-08-14",
      experimentId: experiment.id,
    });

    const initial = await fetch(
      `${application.baseUrl}/api/calendars/${calendar.id}`,
      { method: "DELETE" },
    );
    assert.equal(initial.status, 409);
    assert.deepEqual((await readError(initial)).details, {
      experimentCount: 1,
      taskCount: 1,
      confirmationRequired: true,
      countsChanged: false,
    });

    application.database.createExperiment({
      name: "Added after the prompt",
      color: "#ABCDEF",
      calendarId: calendar.id,
    });
    const stale = await fetch(
      `${application.baseUrl}/api/calendars/${calendar.id}?confirmCascade=true&expectedExperimentCount=1&expectedTaskCount=1`,
      { method: "DELETE" },
    );
    assert.equal(stale.status, 409);
    const staleError = await readError(stale);
    assert.equal(staleError.code, "CALENDAR_CONTENT_CHANGED");
    assert.deepEqual(staleError.details, {
      experimentCount: 2,
      taskCount: 1,
      confirmationRequired: true,
      countsChanged: true,
    });
    assert.ok(application.database.getCalendar(calendar.id));

    const confirmed = await fetch(
      `${application.baseUrl}/api/calendars/${calendar.id}?confirmCascade=true&expectedExperimentCount=2&expectedTaskCount=1`,
      { method: "DELETE" },
    );
    assert.equal(confirmed.status, 204);
    assert.equal(application.database.getCalendar(calendar.id), null);

    const empty = application.database.createCalendar({ name: "Empty calendar" });
    const backwardsCompatible = await fetch(
      `${application.baseUrl}/api/calendars/${empty.id}`,
      { method: "DELETE" },
    );
    assert.equal(backwardsCompatible.status, 204);
  } finally {
    await stopTestApplication(application);
  }
});

test("task API accepts optional quarter-hour times and rejects invalid values", async () => {
  const application = await startTestApplication();
  try {
    const calendar = application.database.createCalendar({ name: "Task API" });
    const experiment = application.database.createExperiment({
      name: "Timed experiment",
      color: "#123456",
      calendarId: calendar.id,
    });
    const baseInput = {
      name: "API task",
      date: "2026-08-14",
      experimentId: experiment.id,
      notes: null,
    };
    const headers = { "Content-Type": "application/json" };

    const untimedResponse = await fetch(`${application.baseUrl}/api/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify(baseInput),
    });
    assert.equal(untimedResponse.status, 201);
    const untimed = await untimedResponse.json() as { id: string; time: string | null };
    assert.equal(untimed.time, null);

    const timedResponse = await fetch(`${application.baseUrl}/api/tasks`, {
      method: "POST",
      headers,
      body: JSON.stringify({ ...baseInput, name: "Timed API task", time: "23:45" }),
    });
    assert.equal(timedResponse.status, 201);
    const timed = await timedResponse.json() as { id: string; time: string | null };
    assert.equal(timed.time, "23:45");

    for (const invalidTime of ["9:15", "09:10", "24:00", "09:15:00", "", 915]) {
      const invalidResponse = await fetch(`${application.baseUrl}/api/tasks`, {
        method: "POST",
        headers,
        body: JSON.stringify({ ...baseInput, time: invalidTime }),
      });
      assert.equal(invalidResponse.status, 400);
      const error = await readError(invalidResponse);
      assert.equal(error.code, "VALIDATION_ERROR");
      assert.deepEqual(error.details, { field: "time" });
    }

    const preserveResponse = await fetch(
      `${application.baseUrl}/api/tasks/${timed.id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ name: "Renamed timed task" }),
      },
    );
    assert.equal(preserveResponse.status, 200);
    assert.equal(
      ((await preserveResponse.json()) as { time: string | null }).time,
      "23:45",
    );

    const removeResponse = await fetch(
      `${application.baseUrl}/api/tasks/${timed.id}`,
      {
        method: "PATCH",
        headers,
        body: JSON.stringify({ time: null }),
      },
    );
    assert.equal(removeResponse.status, 200);
    assert.equal(
      ((await removeResponse.json()) as { time: string | null }).time,
      null,
    );
  } finally {
    await stopTestApplication(application);
  }
});
