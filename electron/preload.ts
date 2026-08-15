import { contextBridge } from "electron";

export interface ExperimentPlannerDesktopBridge {
  readonly isDesktop: true;
  readonly platform: NodeJS.Platform;
}

const bridge: ExperimentPlannerDesktopBridge = Object.freeze({
  isDesktop: true,
  platform: process.platform,
});

contextBridge.exposeInMainWorld("experimentPlannerDesktop", bridge);
