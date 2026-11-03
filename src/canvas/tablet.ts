import { listen } from "@tauri-apps/api/event";
import { useStore } from "../model/store";

export type TabletDevice = "pen" | "eraser" | "cursor" | "unknown";

/**
 * Live tablet state from the native monitor (src-tauri/src/tablet.rs).
 * Read synchronously from pointer handlers; kept outside React for speed.
 */
export const tablet = {
  inProximity: false,
  device: null as TabletDevice | null,
  pressure: 0,
  pressureAt: 0,
  /** Set once the web view itself reports analog pressure; then we prefer it (no IPC lag). */
  webPressureWorks: false,
};

const PRESSURE_FRESH_MS = 120;

function publish() {
  const d = tablet.inProximity ? tablet.device : null;
  useStore.getState().setDevice(d === "eraser" ? "eraser" : d ? "pen" : "mouse");
}

export function initTablet(): () => void {
  const offs = [
    listen<{ entering: boolean; device: TabletDevice }>("tablet://proximity", ({ payload }) => {
      tablet.inProximity = payload.entering;
      tablet.device = payload.entering ? payload.device : null;
      publish();
    }),
    listen<{ pressure: number }>("tablet://pressure", ({ payload }) => {
      tablet.pressure = payload.pressure;
      tablet.pressureAt = performance.now();
      // App may have started with the pen already hovering (no proximity event yet).
      if (!tablet.inProximity) {
        tablet.inProximity = true;
        tablet.device ??= "pen";
        publish();
      }
    }),
  ];
  return () => offs.forEach((p) => p.then((off) => off()));
}

const isAnalog = (p: number) => p > 0 && p < 1 && p !== 0.5;

/** True if this pointer event comes from a pen/stylus (web-reported or native). */
export const isPenEvent = (e: { pointerType: string }) => e.pointerType === "pen" || tablet.inProximity;

/** True if the eraser end (or eraser button) is in use. */
export function isEraserEvent(e: { pointerType: string; button: number; buttons: number }) {
  if (tablet.inProximity && tablet.device === "eraser") return true;
  // Chromium/WebView2-style eraser reporting, and the barrel button.
  return isPenEvent(e) && (e.button === 5 || (e.buttons & 32) !== 0 || e.button === 2);
}

/** Best available pressure for a pointer sample, 0..1. */
export function pressureFor(e: { pointerType: string; pressure: number }): number {
  if (isAnalog(e.pressure)) tablet.webPressureWorks = true;
  if (tablet.webPressureWorks && isPenEvent(e)) return e.pressure;
  if (tablet.inProximity && performance.now() - tablet.pressureAt < PRESSURE_FRESH_MS) {
    return Math.max(0.05, tablet.pressure);
  }
  if (e.pointerType === "pen") return e.pressure || 0.5;
  return 0.5;
}
