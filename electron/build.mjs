import { rm } from "node:fs/promises";
import { resolve } from "node:path";

import { build } from "esbuild";

const projectRoot = resolve(import.meta.dirname, "..");
const outputDirectory = resolve(projectRoot, "dist-electron");

await rm(outputDirectory, { recursive: true, force: true });

await Promise.all([
  build({
    entryPoints: [resolve(projectRoot, "electron/main.ts")],
    outfile: resolve(outputDirectory, "main.mjs"),
    bundle: true,
    external: ["electron"],
    format: "esm",
    platform: "node",
    target: "node24",
    sourcemap: true,
    logLevel: "info",
  }),
  build({
    entryPoints: [resolve(projectRoot, "electron/preload.ts")],
    outfile: resolve(outputDirectory, "preload.cjs"),
    bundle: true,
    external: ["electron"],
    format: "cjs",
    platform: "node",
    target: "node24",
    sourcemap: true,
    logLevel: "info",
  }),
]);
