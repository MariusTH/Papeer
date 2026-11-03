import { baseName, pickOpenFile, saveFileAs, stripExt } from "./io/files";
import { flushSave, libraryDir } from "./io/autosave";
import { parseProject, PROJECT_EXT, serializeProject } from "./io/project";
import { deletePage, insertBlankPageAfter, removeStrokes } from "./model/ops";
import { isPristine, useStore } from "./model/store";
import { blankPage } from "./model/types";
import { exportPdf } from "./pdf/export";
import { openPdfDocument, pagesFromPdf } from "./pdf/load";
import { confirmDialog, errorDialog, isTauri } from "./platform";

const st = () => useStore.getState();

async function report(what: string, e: unknown) {
  console.error(what, e);
  await errorDialog(`${what}\n\n${e instanceof Error ? e.message : String(e)}`);
}

/**
 * Make sure the current document is on disk before replacing or closing it.
 * Everything autosaves, so this only asks if writing actually failed.
 */
export async function confirmDiscard(): Promise<boolean> {
  await flushSave();
  if (!st().dirty) return true;
  return confirmDialog("Your latest changes could not be saved. Discard them?", {
    title: "Save failed",
    okLabel: "Discard",
    cancelLabel: "Cancel",
  });
}

/** Current scroll position of the document view, remembered per tab. */
const scrollTop = () => document.querySelector(".document")?.scrollTop ?? 0;

/** Before checking whether every tab is saved (quitting): any unsaved tab asks. */
export async function confirmQuit(): Promise<boolean> {
  await flushSave();
  const s = st();
  const unsaved = s.tabs.some((t, i) => (i === s.activeTab ? s.dirty : t.dirty));
  if (!unsaved) return true;
  return confirmDialog("Some changes could not be saved. Quit anyway?", {
    title: "Save failed",
    okLabel: "Quit",
    cancelLabel: "Cancel",
  });
}

export async function switchTab(i: number) {
  if (i === st().activeTab) return;
  await flushSave(); // a save in flight must finish before its document is put away
  st().switchTab(i, scrollTop());
}

export async function closeTab(i = st().activeTab) {
  const s = st();
  if (i === s.activeTab) {
    if (!(await confirmDiscard())) return;
  } else if (s.tabs[i]?.dirty) {
    const ok = await confirmDialog(`Changes to “${s.tabs[i].name}” could not be saved. Close anyway?`, { okLabel: "Close" });
    if (!ok) return;
  }
  st().closeTab(i);
}

export const nextTab = (dir: 1 | -1) => {
  const { tabs, activeTab } = st();
  return switchTab((activeTab + dir + tabs.length) % tabs.length);
};

/** Opens documents in a new tab, unless the current tab is an untouched blank page. */
async function show(d: Parameters<ReturnType<typeof st>["loadDoc"]>[0]) {
  await flushSave();
  const s = st();
  s.loadDoc(d, { newTab: !isPristine(s) });
}

export async function newDocument() {
  await flushSave();
  st().loadDoc({ pages: [blankPage()], pdfBytes: null, pdf: null, filePath: null, name: "Untitled" }, { newTab: true });
}

export async function openFile() {
  try {
    const file = await pickOpenFile(isTauri ? await libraryDir().catch(() => undefined) : undefined);
    if (!file) return;
    // Already open? Just switch to it.
    const s = st();
    const open = s.tabs.findIndex((t, i) => (i === s.activeTab ? s.filePath : t.filePath) === file.path);
    if (open >= 0) return switchTab(open);
    const name = stripExt(baseName(file.path));
    if (file.path.toLowerCase().endsWith(`.${PROJECT_EXT}`)) {
      const { pages, pdfBytes } = parseProject(file.bytes);
      const pdf = pdfBytes ? await openPdfDocument(pdfBytes) : null;
      // On the web a picked file has no path to write back to: autosave it as a new browser document.
      await show({ pages, pdfBytes, pdf, filePath: isTauri ? file.path : null, name });
    } else {
      const pdf = await openPdfDocument(file.bytes);
      const pages = await pagesFromPdf(pdf);
      await show({ pages, pdfBytes: file.bytes, pdf, filePath: null, name });
    }
  } catch (e) {
    await report("Could not open file.", e);
  }
}

/**
 * ⌘S saves immediately (autosave would anyway). Save As writes a copy to a chosen file and,
 * on desktop, continues autosaving there; on the web it downloads a copy.
 */
export async function saveProject(saveAs = false): Promise<boolean> {
  if (!saveAs) {
    await flushSave();
    return !st().dirty;
  }
  try {
    const s = st();
    const path = await saveFileAs("project", `${s.name}.${PROJECT_EXT}`, serializeProject({ pages: s.pages, pdfBytes: s.pdfBytes }));
    if (path) st().markSaved(path, stripExt(baseName(path)));
    return true;
  } catch (e) {
    await report("Could not save project.", e);
    return false;
  }
}

export async function exportToPdf() {
  try {
    const s = st();
    await saveFileAs("pdf", `${s.name}.pdf`, await exportPdf(s.pages, s.pdfBytes, { trim: true }));
  } catch (e) {
    await report("Could not export PDF.", e);
  }
}

export function deleteSelection() {
  const s = st();
  if (!s.selection) return;
  s.commit(removeStrokes(s.pages, s.selection.pageId, new Set(s.selection.ids)));
  s.setSelection(null);
}

export function addPageAfterCurrent() {
  const s = st();
  s.commit(insertBlankPageAfter(s.pages, s.currentPage));
  s.setCurrentPage(Math.min(s.currentPage + 1, st().pages.length - 1));
}

export async function deleteCurrentPage() {
  const s = st();
  const page = s.pages[s.currentPage];
  if (!page) return;
  const ok = await confirmDialog(`Delete page ${s.currentPage + 1}?`, { okLabel: "Delete" });
  if (ok) st().commit(deletePage(st().pages, page.id));
}

export const zoomBy = (f: number) => st().setZoom(st().zoom * f);
