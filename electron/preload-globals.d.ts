import type { ExperimentPlannerDesktopBridge } from "./preload";

declare global {
  interface Window {
    readonly experimentPlannerDesktop?: ExperimentPlannerDesktopBridge;
  }
}

export {};
