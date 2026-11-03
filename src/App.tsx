import { useEffect } from "react";
import { Menu, MenuItem, PredefinedMenuItem, Submenu } from "@tauri-apps/api/menu";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  addPageAfterCurrent,
  closeTab,
  confirmQuit,
  deleteCurrentPage,
  deleteSelection,
  exportToPdf,
  newDocument,
  nextTab,
  openFile,
  saveProject,
  switchTab,
  zoomBy,
} from "./actions";
import { DocumentView } from "./canvas/DocumentView";
import { initTablet } from "./canvas/tablet";
import { flushSave, restoreLastSession, startAutosave } from "./io/autosave";
import { useStore } from "./model/store";
import { useTheme } from "./ui/theme";
import { TabBar } from "./ui/TabBar";
import { Thumbnails } from "./ui/Thumbnails";
import { Toolbar } from "./ui/Toolbar";
import { isTauri } from "./platform";
import "./styles.css";


async function buildMenu() {
  const item = (text: string, accelerator: string | undefined, action: () => unknown) =>
    MenuItem.new({ text, accelerator, action: () => void action() });
  const sep = () => PredefinedMenuItem.new({ item: "Separator" });
  const st = useStore.getState;

  const app = await Submenu.new({
    text: "Tablet PDF Writer",
    items: [
      await PredefinedMenuItem.new({ item: { About: null } }),
      await sep(),
      await PredefinedMenuItem.new({ item: "Hide" }),
      await PredefinedMenuItem.new({ item: "HideOthers" }),
      await sep(),
      await item("Quit", "CmdOrCtrl+Q", () => getCurrentWindow().close()),
    ],
  });
  const file = await Submenu.new({
    text: "File",
    items: [
      await item("New Tab", "CmdOrCtrl+T", newDocument),
      await item("New", "CmdOrCtrl+N", newDocument),
      await item("Open…", "CmdOrCtrl+O", openFile),
      await sep(),
      await item("Save", "CmdOrCtrl+S", () => saveProject()),
      await item("Save As…", "CmdOrCtrl+Shift+S", () => saveProject(true)),
      await item("Export PDF…", "CmdOrCtrl+E", exportToPdf),
      await sep(),
      await item("Close Tab", "CmdOrCtrl+W", () => closeTab()),
      await item("Close Window", "CmdOrCtrl+Shift+W", () => getCurrentWindow().close()),
    ],
  });
  const edit = await Submenu.new({
    text: "Edit",
    items: [
      await item("Undo", "CmdOrCtrl+Z", () => st().undo()),
      await item("Redo", "CmdOrCtrl+Shift+Z", () => st().redo()),
      await sep(),
      await item("Delete Selection", undefined, deleteSelection),
      await item("Insert Blank Page", "CmdOrCtrl+Shift+N", addPageAfterCurrent),
      await item("Delete Current Page", undefined, deleteCurrentPage),
    ],
  });
  const view = await Submenu.new({
    text: "View",
    items: [
      await item("Zoom In", "CmdOrCtrl+=", () => zoomBy(1.2)),
      await item("Zoom Out", "CmdOrCtrl+-", () => zoomBy(1 / 1.2)),
      await item("Fit Width", "CmdOrCtrl+0", () => st().requestFit()),
      await sep(),
      await item("Show/Hide Page Thumbnails", "CmdOrCtrl+Alt+T", () => st().toggleThumbs()),
      await item("Show/Hide Notes Margin", "CmdOrCtrl+Alt+M", () => st().toggleNotes()),
      await sep(),
      await item("Next Tab", "CmdOrCtrl+Shift+]", () => nextTab(1)),
      await item("Previous Tab", "CmdOrCtrl+Shift+[", () => nextTab(-1)),
      await sep(),
      await PredefinedMenuItem.new({ item: "Fullscreen" }),
    ],
  });
  const menu = await Menu.new({ items: [app, file, edit, view] });
  await menu.setAsAppMenu();
}

export default function App() {
  const name = useStore((s) => s.name);
  const showThumbs = useStore((s) => s.showThumbs);
  const dirty = useStore((s) => s.dirty);
  const { choice, setChoice } = useTheme();

  useEffect(() => {
    const stopAutosave = startAutosave();
    void restoreLastSession();
    if (!isTauri) {
      // Last chance to write pending edits to localStorage before the page goes away.
      const onHide = () => void flushSave();
      window.addEventListener("pagehide", onHide);
      return () => {
        stopAutosave();
        window.removeEventListener("pagehide", onHide);
      };
    }
    buildMenu().catch((e) => console.error("menu", e));
    const stopTablet = initTablet();
    const unlisten = getCurrentWindow().onCloseRequested(async (ev) => {
      ev.preventDefault();
      if (await confirmQuit()) await getCurrentWindow().destroy();
    });
    return () => {
      stopTablet();
      stopAutosave();
      void unlisten.then((f) => f());
    };
  }, []);

  useEffect(() => {
    const title = `${dirty ? "● " : ""}${name} — Tablet PDF Writer`;
    document.title = title;
    if (isTauri) getCurrentWindow().setTitle(title).catch(() => {});
  }, [name, dirty]);

  // Single-key tool shortcuts (⌘ shortcuts live in the native menu).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.ctrlKey && e.key === "Tab") {
        e.preventDefault();
        void nextTab(e.shiftKey ? -1 : 1);
        return;
      }
      if (e.metaKey && /^[1-9]$/.test(e.key)) {
        e.preventDefault();
        const { tabs } = useStore.getState();
        void switchTab(e.key === "9" ? tabs.length - 1 : Number(e.key) - 1);
        return;
      }
      // The desktop app routes ⌘ shortcuts through its native menu; the web build needs them here.
      // (Browsers reserve ⌘N / ⌘T / ⌘W, so new/close tab use the tab bar on the web.)
      if (!isTauri && (e.metaKey || e.ctrlKey) && !e.altKey) {
        const st = useStore.getState();
        const k = e.key.toLowerCase();
        const cmd: Record<string, () => unknown> = {
          z: () => (e.shiftKey ? st.redo() : st.undo()),
          y: () => st.redo(),
          s: () => saveProject(e.shiftKey),
          o: openFile,
          e: exportToPdf,
          "=": () => zoomBy(1.2),
          "+": () => zoomBy(1.2),
          "-": () => zoomBy(1 / 1.2),
          "0": () => st.requestFit(),
        };
        const fn = cmd[k];
        if (fn) {
          e.preventDefault();
          void fn();
          return;
        }
      }
      if (e.metaKey || e.ctrlKey || e.altKey) return;
      const s = useStore.getState();
      const tools: Record<string, () => void> = {
        p: () => s.setTool("pen"),
        h: () => s.setTool("highlighter"),
        e: () => s.setTool("eraser"),
        l: () => s.setTool("lasso"),
        Escape: () => s.setSelection(null),
        Delete: deleteSelection,
        Backspace: deleteSelection,
      };
      const fn = tools[e.key];
      if (fn) {
        e.preventDefault();
        fn();
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <div className="app">
      <Toolbar theme={choice} onTheme={setChoice} />
      <TabBar />
      <div className="workspace">
        {showThumbs && <Thumbnails />}
        <DocumentView />
      </div>
    </div>
  );
}
