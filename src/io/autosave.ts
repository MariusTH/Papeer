import { useStore } from "../model/store";
import { openPdfDocument } from "../pdf/load";
import { baseName, stripExt } from "./files";
import { parseProject, serializeProject } from "./project";
import { docStore } from "./storage";

export { libraryDir } from "./storage";

/**
 * Continuous autosave. Every edited document is stored: in the file the user chose, or in
 * a new one in the library (desktop: ~/Documents/Tablet PDF Writer/, web: localStorage).
 * Writes are atomic, and the documents open in tabs are reopened on launch.
 */

const IDLE_MS = 1500; // save this long after the last change…
const MAX_WAIT_MS = 8000; // …but never wait longer than this while writing continuously.

let idleTimer: ReturnType<typeof setTimeout> | undefined;
let maxTimer: ReturnType<typeof setTimeout> | undefined;
let running: Promise<void> | null = null;
let again = false;
let lastError = "";

/** Message from the most recent failed save, for the status tooltip. */
export const lastSaveError = () => lastError;

const st = () => useStore.getState();

/** Files open in tabs, in order, plus which one is active. */
function openFiles() {
  const s = st();
  const files: string[] = [];
  let active = 0;
  s.tabs.forEach((t, i) => {
    const path = i === s.activeTab ? s.filePath : t.filePath;
    if (!path) return;
    if (i === s.activeTab) active = files.length;
    files.push(path);
  });
  return { files, active };
}

async function rememberSession() {
  try {
    await docStore().writeSession(JSON.stringify(openFiles()));
  } catch (e) {
    console.warn("could not record session", e);
  }
}

async function saveOnce() {
  const s = st();
  if (!s.dirty) return;
  // Don't snapshot half-finished gestures (erasing / moving); try again shortly.
  if (s.txBase) {
    schedule();
    return;
  }
  const { pages, pdfBytes, docVersion } = s;
  let path = s.filePath;
  st().setSaveState("saving");
  try {
    if (!path) path = await docStore().newPath(s.name);
    await docStore().write(path, serializeProject({ pages, pdfBytes }));
    // Tab switches wait for saves, so the shown document is still the one we wrote.
    if (st().docVersion !== docVersion) return;
    // Only clear `dirty` if nothing changed while we were writing.
    const isNew = st().filePath !== path;
    st().markAutosaved(path, pages);
    if (isNew) await rememberSession();
  } catch (e) {
    console.error("autosave failed", e);
    lastError = e instanceof Error ? e.message : String(e);
    st().setSaveState("error");
  }
}

/** Save now (waits for any in-flight save, then writes the latest state). */
export function flushSave(): Promise<void> {
  clearTimeout(idleTimer);
  clearTimeout(maxTimer);
  idleTimer = maxTimer = undefined;
  if (running) {
    again = true;
    return running;
  }
  running = (async () => {
    do {
      again = false;
      await saveOnce();
    } while (again);
  })().finally(() => {
    running = null;
  });
  return running;
}

function schedule() {
  clearTimeout(idleTimer);
  idleTimer = setTimeout(flushSave, IDLE_MS);
  maxTimer ??= setTimeout(flushSave, MAX_WAIT_MS);
}

/** Starts watching the store for changes. Returns a stop function. */
export function startAutosave(): () => void {
  const unsub = useStore.subscribe((s, prev) => {
    if (s.dirty && (s.pages !== prev.pages || s.dirty !== prev.dirty)) schedule();
    if (s.filePath !== prev.filePath || s.tabs.length !== prev.tabs.length || s.activeTab !== prev.activeTab) {
      void rememberSession();
    }
  });
  const onHide = () => {
    if (document.visibilityState === "hidden") void flushSave();
  };
  document.addEventListener("visibilitychange", onHide);
  window.addEventListener("blur", onHide);
  return () => {
    unsub();
    document.removeEventListener("visibilitychange", onHide);
    window.removeEventListener("blur", onHide);
  };
}

/** Reopens the documents that were open when the app last closed (or was killed). */
export async function restoreLastSession(): Promise<boolean> {
  try {
    const json = await docStore().readSession();
    if (!json) return false;
    const saved = JSON.parse(json) as { files?: string[]; active?: number; filePath?: string };
    const files = saved.files ?? (saved.filePath ? [saved.filePath] : []);
    let opened = 0;
    let active = 0;
    for (const [i, filePath] of files.entries()) {
      try {
        const bytes = await docStore().read(filePath);
        if (!bytes) continue;
        const { pages, pdfBytes } = parseProject(bytes);
        const pdf = pdfBytes ? await openPdfDocument(pdfBytes) : null;
        st().loadDoc({ pages, pdfBytes, pdf, filePath, name: stripExt(baseName(filePath)) }, { newTab: opened > 0 });
        st().setSaveState("saved");
        if (i === saved.active) active = opened;
        opened++;
      } catch (e) {
        console.error("could not reopen", filePath, e);
      }
    }
    if (opened > 1) st().switchTab(active, 0);
    return opened > 0;
  } catch (e) {
    console.error("could not restore last session", e);
    return false;
  }
}
