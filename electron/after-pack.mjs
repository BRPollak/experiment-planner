import { execFileSync } from "node:child_process";
import { statSync } from "node:fs";
import { join } from "node:path";

const PLUTIL = "/usr/bin/plutil";
const CODESIGN = "/usr/bin/codesign";

export const requiredNoticeResources = Object.freeze([
  Object.freeze({ filename: "LICENSE.electron.txt", minimumBytes: 100 }),
  Object.freeze({ filename: "LICENSES.chromium.html", minimumBytes: 1_000 }),
  Object.freeze({ filename: "THIRD_PARTY_NOTICES.txt", minimumBytes: 500 }),
]);

const unusedPermissionKeys = [
  "NSAudioCaptureUsageDescription",
  "NSBluetoothAlwaysUsageDescription",
  "NSBluetoothPeripheralUsageDescription",
  "NSCameraUsageDescription",
  "NSMicrophoneUsageDescription",
];

function readPlist(plistPath) {
  const json = execFileSync(
    PLUTIL,
    ["-convert", "json", "-o", "-", "--", plistPath],
    { encoding: "utf8" },
  );

  return JSON.parse(json);
}

function replaceBoolean(plistPath, keyPath, value) {
  execFileSync(
    PLUTIL,
    ["-replace", keyPath, "-bool", value ? "YES" : "NO", "--", plistPath],
    { stdio: "inherit" },
  );
}

function removeKey(plistPath, keyPath) {
  execFileSync(PLUTIL, ["-remove", keyPath, "--", plistPath], {
    stdio: "inherit",
  });
}

export function validateRequiredNoticeResources(appPath) {
  const resourcesPath = join(appPath, "Contents", "Resources");

  for (const { filename, minimumBytes } of requiredNoticeResources) {
    const noticePath = join(resourcesPath, filename);
    let noticeStat;
    try {
      noticeStat = statSync(noticePath);
    } catch (error) {
      throw new Error(`Required packaged notice is missing: ${noticePath}`, {
        cause: error,
      });
    }

    if (!noticeStat.isFile() || noticeStat.size < minimumBytes) {
      throw new Error(`Required packaged notice is empty or invalid: ${noticePath}`);
    }
  }
}

/**
 * electron-builder broadens App Transport Security and adds generic media
 * permission descriptions to every Electron app. This application serves its
 * renderer only from its own loopback server and denies every runtime
 * permission, so narrow the final plist before electron-builder signs it.
 */
export default async function afterPack(context) {
  if (context.electronPlatformName !== "darwin") {
    return;
  }

  const appName = context.packager.appInfo.productFilename;
  const appPath = join(context.appOutDir, `${appName}.app`);
  const plistPath = join(
    appPath,
    "Contents",
    "Info.plist",
  );
  const before = readPlist(plistPath);

  replaceBoolean(
    plistPath,
    "NSAppTransportSecurity.NSAllowsArbitraryLoads",
    false,
  );

  if (
    Object.hasOwn(
      before.NSAppTransportSecurity ?? {},
      "NSAllowsLocalNetworking",
    )
  ) {
    removeKey(plistPath, "NSAppTransportSecurity.NSAllowsLocalNetworking");
  }

  for (const key of unusedPermissionKeys) {
    if (Object.hasOwn(before, key)) {
      removeKey(plistPath, key);
    }
  }

  const after = readPlist(plistPath);
  const transportSecurity = after.NSAppTransportSecurity ?? {};
  const exceptionDomains = Object.keys(
    transportSecurity.NSExceptionDomains ?? {},
  );
  const unexpectedDomains = exceptionDomains.filter(
    (domain) => domain !== "localhost" && domain !== "127.0.0.1",
  );

  if (
    transportSecurity.NSAllowsArbitraryLoads !== false ||
    Object.hasOwn(transportSecurity, "NSAllowsLocalNetworking") ||
    unexpectedDomains.length > 0 ||
    unusedPermissionKeys.some((key) => Object.hasOwn(after, key))
  ) {
    throw new Error(`Failed to harden packaged Info.plist at ${plistPath}`);
  }

  validateRequiredNoticeResources(appPath);

  // `identity: null` intentionally avoids Developer ID signing, but the
  // Electron distribution still contains nested signature metadata. Re-sign
  // the fully hardened local bundle ad hoc so macOS can validate all nested
  // code and the outer resource seal consistently.
  execFileSync(
    CODESIGN,
    ["--force", "--deep", "--sign", "-", "--timestamp=none", "--", appPath],
    { stdio: "inherit" },
  );
  execFileSync(
    CODESIGN,
    ["--verify", "--deep", "--strict", "--verbose=2", "--", appPath],
    { stdio: "inherit" },
  );
}
