import type { PDFDocumentProxy } from "pdfjs-dist";
import { create } from "zustand";
import { emptyHistory, History, record, redo, undo } from "./history";
import { BRUSH_IDS, DEFAULT_BRUSH, PressureContrast, PressureSettings } from "../ink/brushes";
import { blankPage, BrushId, InkTool, Page, Tool } from "./types";

export const PEN_COLORS = ["#1a1a1a", "#1d4ed8", "#dc2626", "#15803d"];
export const HIGHLIGHTER_COLORS = ["#facc15", "#4ade80", "#f472b6", "#60a5fa"];
export const SIZES: Record<Tool, number[]> = {
  pen: [1.2, 2, 3.5],
  highlighter: [10, 16, 24],
  eraser: [5, 12, 24],
  lasso: [1],
};

export type SaveState = "idle" | "saving" | "saved" | "error";
export type InputDevice = "mouse" | "pen" | "eraser";

/** Everything that belongs to one open document (one tab). */
export interface DocTab {
  pages: Page[];
  pdfBytes: Uint8Array | null;
  pdf: PDFDocumentProxy | null;
  filePath: string | null;
  name: string;
  dirty: boolean;
  saveState: SaveState;
  history: History;
  zoom: number;
  fitMode: boolean;
  currentPage: number;
  scrollTop: number;
}

export interface Selection {
  pageId: string;
  ids: string[];
}

interface State {
  pages: Page[];
  pdfBytes: Uint8Array | null;
  pdf: PDFDocumentProxy | null;
  /** Saved .inkpdf path, if any. */
  filePath: string | null;
  /** Display name for the window title / default export name. */
  name: string;
  dirty: boolean;
  saveState: SaveState;
  history: History;
  /** Snapshot taken at the start of a multi-event gesture (erase, move). */
  txBase: Page[] | null;

  tool: Tool;
  colors: Record<InkTool, string>;
  /** Pen tip used for new pen strokes. */
  brush: BrushId;
  /** How pen pressure is shaped before it reaches the brush. */
  pressure: PressureSettings;
  sizeIndex: Record<Tool, number>;
  selection: Selection | null;

  /** Active input device, from native tablet events. The eraser end temporarily overrides the tool. */
  device: InputDevice;

  zoom: number;
  /** Zoom follows the window width (until the user zooms manually). */
  fitMode: boolean;
  /** Incremented to ask the view to fit page width. */
  fitRequest: number;
  /** Incremented each time the shown document changes (load or tab switch). */
  docVersion: number;
  /** Scroll position to restore when the shown document changes. */
  restoreScroll: number;

  /** Open documents. The active one's live state is in the top-level fields; its slot here is stale. */
  tabs: DocTab[];
  activeTab: number;
  currentPage: number;

  /** Show the page thumbnail sidebar. */
  showThumbs: boolean;
  /** Show the per-page notes margin (never exported). */
  showNotes: boolean;
}

interface Actions {
  /** Shows a document, in a new tab or replacing the active tab's document. */
  loadDoc(
    d: { pages: Page[]; pdfBytes: Uint8Array | null; pdf: PDFDocumentProxy | null; filePath: string | null; name: string },
    opts?: { newTab?: boolean },
  ): void;
  switchTab(i: number, scrollTop: number): void;
  closeTab(i: number): void;
  /** Replace pages and record one undo step. */
  commit(pages: Page[]): void;
  begin(): void;
  /** Update pages during a gesture without recording history. */
  setTransient(pages: Page[]): void;
  end(): void;
  undo(): void;
  redo(): void;
  markSaved(filePath: string, name: string): void;
  /** After an autosave of `pages` to `filePath`; stays dirty if pages changed meanwhile. */
  markAutosaved(filePath: string, pages: Page[]): void;
  setSaveState(s: SaveState): void;

  setTool(t: Tool): void;
  setColor(t: InkTool, c: string): void;
  setBrush(b: BrushId): void;
  setPressure(p: Partial<PressureSettings>): void;
  setSizeIndex(t: Tool, i: number): void;
  setSelection(s: Selection | null): void;
  setDevice(d: InputDevice): void;
  setZoom(z: number): void;
  /** Zoom set by fit-to-width; keeps fit mode on. */
  setFitZoom(z: number): void;
  requestFit(): void;
  setCurrentPage(i: number): void;
  toggleThumbs(): void;
  toggleNotes(): void;
}

const readPref = (key: string, fallback: boolean) => {
  try {
    const v = localStorage.getItem(key);
    return v === null ? fallback : v === "1";
  } catch {
    return fallback;
  }
};
const writePref = (key: string, v: boolean) => {
  try {
    localStorage.setItem(key, v ? "1" : "0");
  } catch {
    // Preferences are a convenience; ignore storage failures.
  }
};

const readChoice = <T extends string>(key: string, allowed: readonly T[], fallback: T): T => {
  try {
    const v = localStorage.getItem(key) as T | null;
    return v && allowed.includes(v) ? v : fallback;
  } catch {
    return fallback;
  }
};
const readNumber = (key: string, fallback: number) => {
  try {
    const v = Number(localStorage.getItem(key));
    return localStorage.getItem(key) !== null && Number.isFinite(v) ? v : fallback;
  } catch {
    return fallback;
  }
};
const writeChoice = (key: string, v: string) => {
  try {
    localStorage.setItem(key, v);
  } catch {
    // ignore
  }
};

export const MIN_ZOOM = 0.25;
export const MAX_ZOOM = 5;
export const clampZoom = (z: number) => Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z));

const blankDoc = (): DocTab => ({
  pages: [blankPage()],
  pdfBytes: null,
  pdf: null,
  filePath: null,
  name: "Untitled",
  dirty: false,
  saveState: "idle",
  history: emptyHistory(),
  zoom: 1,
  fitMode: true,
  currentPage: 0,
  scrollTop: 0,
});

const snapshot = (s: State, scrollTop: number): DocTab => ({
  pages: s.pages,
  pdfBytes: s.pdfBytes,
  pdf: s.pdf,
  filePath: s.filePath,
  name: s.name,
  dirty: s.dirty,
  saveState: s.saveState,
  history: s.history,
  zoom: s.zoom,
  fitMode: s.fitMode,
  currentPage: s.currentPage,
  scrollTop,
});

/** True for the untouched blank document a fresh window starts with. */
export const isPristine = (s: State) =>
  !s.filePath && !s.dirty && !s.pdf && s.history.past.length === 0 && s.pages.length === 1 && s.pages[0].strokes.length === 0;

/** Top-level fields that show `d`. */
const show = (s: State, d: DocTab) => ({
  ...d,
  txBase: null,
  selection: null,
  docVersion: s.docVersion + 1,
  restoreScroll: d.scrollTop,
});

export const useStore = create<State & Actions>()((set) => ({
  ...blankDoc(),
  txBase: null,

  tool: "pen",
  colors: { pen: PEN_COLORS[0], highlighter: HIGHLIGHTER_COLORS[0] },
  brush: readChoice("brush", BRUSH_IDS, DEFAULT_BRUSH),
  pressure: {
    contrast: readChoice<PressureContrast>("pressureContrast", ["low", "medium", "high"], "medium"),
    thinStart: readNumber("pressureThinStart", 0.3),
  },
  sizeIndex: { pen: 1, highlighter: 1, eraser: 1, lasso: 0 },
  selection: null,

  device: "mouse",

  fitRequest: 0,
  docVersion: 0,
  restoreScroll: 0,

  tabs: [blankDoc()],
  activeTab: 0,

  showThumbs: readPref("showThumbs", true),
  showNotes: readPref("showNotes", true),

  loadDoc: (d, opts) =>
    set((s) => {
      const doc: DocTab = { ...blankDoc(), ...d };
      if (opts?.newTab) {
        const tabs = [...s.tabs];
        tabs[s.activeTab] = snapshot(s, 0);
        tabs.push(doc);
        return { ...show(s, doc), tabs, activeTab: tabs.length - 1, fitRequest: s.fitRequest + 1 };
      }
      if (s.pdf && s.pdf !== d.pdf) void s.pdf.loadingTask.destroy();
      const tabs = [...s.tabs];
      tabs[s.activeTab] = doc;
      return { ...show(s, doc), tabs, fitRequest: s.fitRequest + 1 };
    }),

  switchTab: (i, scrollTop) =>
    set((s) => {
      if (i === s.activeTab || !s.tabs[i]) return {};
      const tabs = [...s.tabs];
      tabs[s.activeTab] = snapshot(s, scrollTop);
      return { ...show(s, tabs[i]), tabs, activeTab: i };
    }),

  closeTab: (i) =>
    set((s) => {
      if (!s.tabs[i]) return {};
      const closing = i === s.activeTab ? s.pdf : s.tabs[i].pdf;
      if (closing) void closing.loadingTask.destroy();
      if (s.tabs.length === 1) {
        const doc = blankDoc();
        return { ...show(s, doc), tabs: [doc], activeTab: 0, fitRequest: s.fitRequest + 1 };
      }
      const tabs = s.tabs.filter((_, j) => j !== i);
      if (i !== s.activeTab) return { tabs, activeTab: s.activeTab > i ? s.activeTab - 1 : s.activeTab };
      const next = Math.min(i, tabs.length - 1);
      return { ...show(s, tabs[next]), tabs, activeTab: next };
    }),

  commit: (pages) =>
    set((s) => ({ pages, history: record(s.history, s.pages), dirty: true })),

  begin: () => set((s) => ({ txBase: s.pages })),
  setTransient: (pages) => set({ pages }),
  end: () =>
    set((s) => {
      if (!s.txBase) return {};
      if (s.txBase === s.pages) return { txBase: null };
      return { txBase: null, history: record(s.history, s.txBase), dirty: true };
    }),

  undo: () =>
    set((s) => {
      const r = undo(s.history, s.pages);
      return r ? { ...r, selection: null, dirty: true } : {};
    }),
  redo: () =>
    set((s) => {
      const r = redo(s.history, s.pages);
      return r ? { ...r, selection: null, dirty: true } : {};
    }),
  markSaved: (filePath, name) => set({ filePath, name, dirty: false, saveState: "saved" }),
  markAutosaved: (filePath, pages) =>
    set((s) => ({
      filePath,
      dirty: s.pages !== pages,
      saveState: s.pages !== pages ? "saving" : "saved",
      name: s.filePath === filePath ? s.name : filePath.split(/[\\/]/).pop()!.replace(/\.[^.]+$/, ""),
    })),
  setSaveState: (saveState) => set({ saveState }),

  setTool: (tool) => set((s) => ({ tool, selection: tool === "lasso" ? s.selection : null })),
  setColor: (t, c) => set((s) => ({ colors: { ...s.colors, [t]: c }, tool: t })),
  setBrush: (brush) => {
    writeChoice("brush", brush);
    set({ brush, tool: "pen" });
  },
  setPressure: (patch) =>
    set((s) => {
      const pressure = { ...s.pressure, ...patch };
      writeChoice("pressureContrast", pressure.contrast);
      writeChoice("pressureThinStart", String(pressure.thinStart));
      return { pressure };
    }),
  setSizeIndex: (t, i) => set((s) => ({ sizeIndex: { ...s.sizeIndex, [t]: i } })),
  setSelection: (selection) => set({ selection }),
  setDevice: (device) => set((s) => (s.device === device ? {} : { device })),
  setZoom: (z) => set({ zoom: clampZoom(z), fitMode: false }),
  setFitZoom: (z) => set({ zoom: clampZoom(z), fitMode: true }),
  requestFit: () => set((s) => ({ fitRequest: s.fitRequest + 1, fitMode: true })),
  setCurrentPage: (currentPage) => set({ currentPage }),
  toggleThumbs: () =>
    set((s) => {
      writePref("showThumbs", !s.showThumbs);
      return { showThumbs: !s.showThumbs };
    }),
  toggleNotes: () =>
    set((s) => {
      writePref("showNotes", !s.showNotes);
      return { showNotes: !s.showNotes, fitRequest: s.fitRequest + 1 };
    }),
}));

export const currentSize = (s: State, t: Tool) => SIZES[t][s.sizeIndex[t]] ?? SIZES[t][0];

/** Tool actually in effect: flipping the pen to its eraser end switches to the eraser (like Krita). */
export const effectiveTool = (s: State): Tool => (s.device === "eraser" ? "eraser" : s.tool);
