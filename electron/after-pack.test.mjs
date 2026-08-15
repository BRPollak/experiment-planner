import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, test } from "node:test";

import {
  requiredNoticeResources,
  validateRequiredNoticeResources,
} from "./after-pack.mjs";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const temporaryDirectories = [];

function temporaryAppPath() {
  const directory = mkdtempSync(join(tmpdir(), "experiment-planner-after-pack-test-"));
  temporaryDirectories.push(directory);
  const appPath = join(directory, "Experiment Planner.app");
  mkdirSync(join(appPath, "Contents", "Resources"), { recursive: true });
  return appPath;
}

function writeNotices(appPath) {
  const resourcesPath = join(appPath, "Contents", "Resources");
  for (const { filename, minimumBytes } of requiredNoticeResources) {
    writeFileSync(join(resourcesPath, filename), "x".repeat(minimumBytes));
  }
}

afterEach(() => {
  while (temporaryDirectories.length > 0) {
    rmSync(temporaryDirectories.pop(), { recursive: true, force: true });
  }
});

test("packaging metadata includes required notices and release constraints", () => {
  const packageJson = JSON.parse(
    readFileSync(join(projectRoot, "package.json"), "utf8"),
  );
  const packageLock = JSON.parse(
    readFileSync(join(projectRoot, "package-lock.json"), "utf8"),
  );

  assert.equal(packageJson.version, packageLock.version);
  assert.equal(packageJson.version, packageLock.packages[""].version);
  assert.equal(packageJson.license, "UNLICENSED");
  assert.equal(packageJson.scripts.postinstall, "install-electron");
  assert.equal(packageJson.build.mac.minimumSystemVersion, "12.0");
  assert.ok(packageJson.build.files.includes("!dist-electron/**/*.map"));
  assert.deepEqual(packageJson.build.extraResources, [
    {
      from: "node_modules/electron/dist/LICENSE",
      to: "LICENSE.electron.txt",
    },
    {
      from: "node_modules/electron/dist/LICENSES.chromium.html",
      to: "LICENSES.chromium.html",
    },
    {
      from: "THIRD_PARTY_NOTICES.txt",
      to: "THIRD_PARTY_NOTICES.txt",
    },
  ]);

  for (const resource of packageJson.build.extraResources) {
    const source = join(projectRoot, resource.from);
    assert.ok(
      readFileSync(source).length > 0,
      `${resource.from} must exist and be nonempty`,
    );
  }
});

test("notice validation accepts complete packaged resources", () => {
  const appPath = temporaryAppPath();
  writeNotices(appPath);
  assert.doesNotThrow(() => validateRequiredNoticeResources(appPath));
});

test("notice validation rejects missing or truncated packaged resources", () => {
  const appPath = temporaryAppPath();
  assert.throws(
    () => validateRequiredNoticeResources(appPath),
    /Required packaged notice is missing/,
  );

  writeNotices(appPath);
  const firstNotice = requiredNoticeResources[0];
  writeFileSync(
    join(appPath, "Contents", "Resources", firstNotice.filename),
    "too short",
  );
  assert.throws(
    () => validateRequiredNoticeResources(appPath),
    /Required packaged notice is empty or invalid/,
  );
});
