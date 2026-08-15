import { createServer } from "node:http";
import { resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { createApplication } from "./app";
import { ExperimentPlannerDatabase, getDatabasePath } from "./database";

const defaultPort = process.env.NODE_ENV === "production" ? "4173" : "8787";
const configuredPort = Number.parseInt(process.env.PORT ?? defaultPort, 10);
if (!Number.isInteger(configuredPort) || configuredPort < 1 || configuredPort > 65_535) {
  throw new Error("PORT must be an integer between 1 and 65535.");
}

const database = await ExperimentPlannerDatabase.open(getDatabasePath());
const staticDirectory = fileURLToPath(new URL("../dist", import.meta.url));
const server = createServer(
  createApplication({
    database,
    production: process.env.NODE_ENV === "production",
    staticDirectory: resolve(staticDirectory),
  }),
);

server.listen(configuredPort, "127.0.0.1", () => {
  console.log(`Experiment Planner is running at http://127.0.0.1:${configuredPort}`);
  console.log(`Database: ${database.path}`);
});

let shuttingDown = false;
function shutDown(signal: string): void {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`Received ${signal}; shutting down.`);
  server.close(() => {
    database.close();
    process.exitCode = 0;
  });
  setTimeout(() => {
    database.close();
    process.exitCode = 1;
  }, 5_000).unref();
}

process.on("SIGINT", () => shutDown("SIGINT"));
process.on("SIGTERM", () => shutDown("SIGTERM"));

server.on("error", (error) => {
  console.error("Server failed", error);
  database.close();
  process.exitCode = 1;
});
