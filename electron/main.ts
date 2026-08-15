import {
  app,
  BrowserWindow,
  dialog,
  session,
  type Session,
} from "electron";
import { createServer, type Server } from "node:http";
import { join } from "node:path";

import { createApplication } from "../server/app";
import {
  ExperimentPlannerDatabase,
  getDatabasePath,
} from "../server/database";
import { importLegacyDatabaseIfRequested } from "./legacy-import";

const PRODUCT_NAME = "Experiment Planner";
const DATABASE_FILENAME = "experiment-planner.sqlite";
const CONTENT_SECURITY_POLICY = [
  "default-src 'self'",
  "script-src 'self'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data:",
  "connect-src 'self'",
  "font-src 'self'",
  "object-src 'none'",
  "base-uri 'none'",
  "form-action 'none'",
  "frame-ancestors 'none'",
].join("; ");

app.setName(PRODUCT_NAME);

let mainWindow: BrowserWindow | null = null;
let database: ExperimentPlannerDatabase | null = null;
let localServer: Server | null = null;
let rendererUrl: string | null = null;

async function listen(server: Server): Promise<number> {
  return await new Promise<number>((resolvePort, reject) => {
    const handleError = (error: Error) => reject(error);
    server.once("error", handleError);
    server.listen(0, "127.0.0.1", () => {
      server.off("error", handleError);
      const address = server.address();
      if (!address || typeof address === "string") {
        reject(new Error("The local application server did not provide a TCP port."));
        return;
      }
      resolvePort(address.port);
    });
  });
}

function isRendererUrl(url: string, allowedOrigin: string): boolean {
  try {
    return new URL(url).origin === allowedOrigin;
  } catch {
    return false;
  }
}

function secureRendererSession(rendererSession: Session, allowedOrigin: string): void {
  rendererSession.setPermissionCheckHandler(() => false);
  rendererSession.setPermissionRequestHandler((_webContents, _permission, callback) => {
    callback(false);
  });

  rendererSession.webRequest.onBeforeRequest((details, callback) => {
    callback({ cancel: !isRendererUrl(details.url, allowedOrigin) });
  });
  rendererSession.webRequest.onHeadersReceived((details, callback) => {
    const responseHeaders = { ...(details.responseHeaders ?? {}) };
    if (isRendererUrl(details.url, allowedOrigin)) {
      responseHeaders["Content-Security-Policy"] = [CONTENT_SECURITY_POLICY];
    }
    callback({ responseHeaders });
  });
}

async function startApplicationServices(): Promise<void> {
  const databasePath = process.env.EXPERIMENT_PLANNER_DB?.trim()
    ? getDatabasePath()
    : join(app.getPath("userData"), DATABASE_FILENAME);
  await importLegacyDatabaseIfRequested(databasePath);

  database = await ExperimentPlannerDatabase.open(databasePath);
  const staticDirectory = join(app.getAppPath(), "dist");
  localServer = createServer(
    createApplication({
      database,
      production: true,
      staticDirectory,
    }),
  );
  const port = await listen(localServer);
  rendererUrl = `http://127.0.0.1:${port}`;

  const rendererSession = session.fromPartition("persist:experiment-planner");
  secureRendererSession(rendererSession, rendererUrl);
}

async function createMainWindow(): Promise<void> {
  if (!rendererUrl) {
    throw new Error("The local application server has not started.");
  }

  const allowedOrigin = new URL(rendererUrl).origin;
  const preloadPath = join(app.getAppPath(), "dist-electron", "preload.cjs");
  const window = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 900,
    minHeight: 620,
    show: false,
    title: PRODUCT_NAME,
    backgroundColor: "#ffffff",
    webPreferences: {
      preload: preloadPath,
      partition: "persist:experiment-planner",
      nodeIntegration: false,
      contextIsolation: true,
      sandbox: true,
      webSecurity: true,
      allowRunningInsecureContent: false,
      webviewTag: false,
      navigateOnDragDrop: false,
      safeDialogs: true,
    },
  });

  mainWindow = window;
  window.once("ready-to-show", () => window.show());
  window.on("closed", () => {
    if (mainWindow === window) mainWindow = null;
  });
  window.webContents.on("will-attach-webview", (event) => event.preventDefault());
  window.webContents.on("will-navigate", (event, url) => {
    if (!isRendererUrl(url, allowedOrigin)) event.preventDefault();
  });
  window.webContents.on("will-redirect", (event, url) => {
    if (!isRendererUrl(url, allowedOrigin)) event.preventDefault();
  });
  window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));

  await window.loadURL(rendererUrl);
}

function stopApplicationServices(): void {
  if (localServer) {
    localServer.close();
    localServer.closeAllConnections();
    localServer = null;
  }
  database?.close();
  database = null;
  rendererUrl = null;
}

const hasSingleInstanceLock = app.requestSingleInstanceLock();

if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on("second-instance", () => {
    if (!mainWindow) return;
    if (mainWindow.isMinimized()) mainWindow.restore();
    mainWindow.show();
    mainWindow.focus();
  });

  app.on("activate", () => {
    if (!mainWindow && rendererUrl) {
      void createMainWindow().catch((error) => {
        console.error("Could not recreate the application window", error);
      });
    }
  });

  app.on("window-all-closed", () => {
    if (process.platform !== "darwin") app.quit();
  });
  app.on("will-quit", stopApplicationServices);

  void app.whenReady()
    .then(async () => {
      await startApplicationServices();
      await createMainWindow();
    })
    .catch((error) => {
      const message = error instanceof Error ? error.message : String(error);
      console.error("Experiment Planner could not start", error);
      stopApplicationServices();
      dialog.showErrorBox(`${PRODUCT_NAME} could not start`, message);
      app.quit();
    });
}
