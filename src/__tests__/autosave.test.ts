import { beforeEach, describe, expect, it, vi } from "vitest";

const disk = new Map<string, Uint8Array | string>();
const ops: string[] = [];
let failWrites = false;

vi.mock("@tauri-apps/api/path", () => ({
  appDataDir: async () => "/support/com.mariushorne.papeer",
  dirname: async (p: string) => p.split("/").slice(0, -1).join("/"),
  documentDir: async () => "/docs",
  join: async (...p: string[]) => p.join("/"),
}));
vi.mock("@tauri-apps/plugin-fs", () => ({
  exists: async (p: string) => disk.has(p) || [...disk.keys()].some((k) => k.startsWith(p + "/")),
  mkdir: async () => {},
  writeFile: async (p: string, b: Uint8Array) => {
    if (failWrites) throw new Error("disk full");
    ops.push(`write ${p}`);
    disk.set(p, b);
  },
  writeTextFile: async (p: string, t: string) => void disk.set(p, t),
  readTextFile: async (p: string) => disk.get(p) as string,
  readFile: async (p: string) => disk.get(p) as Uint8Array,
  rename: async (a: string, b: string) => {
    ops.push(`rename ${a} -> ${b}`);
    // Files and whole folders.
    for (const [k, v] of [...disk]) {
      if (k === a || k.startsWith(a + "/")) {
        disk.delete(k);
        disk.set(b + k.slice(a.length), v);
      }
    }
  },
}));
vi.mock("../pdf/load", () => ({ openPdfDocument: async () => null }));

const { flushSave, restoreLastSession } = await import("../io/autosave");
const { fileStore, setDocStore } = await import("../io/storage");
setDocStore(fileStore);
const { useStore } = await import("../model/store");
const { addStroke } = await import("../model/ops");
const { parseProject, serializeProject } = await import("../io/project");
const { blankPage } = await import("../model/types");

const stroke = (id: string) => ({ id, tool: "pen" as const, color: "#000000", size: 2, points: [{ x: 10, y: 10, p: 0.5 }] });

function edit(id: string) {
  const s = useStore.getState();
  s.commit(addStroke(s.pages, s.pages[0].id, stroke(id)));
}

beforeEach(() => {
  disk.clear();
  ops.length = 0;
  failWrites = false;
  while (useStore.getState().tabs.length > 1) useStore.getState().closeTab(0);
  useStore.getState().loadDoc({ pages: [blankPage()], pdfBytes: null, pdf: null, filePath: null, name: "Notes" });
});

describe("autosave", () => {
  it("does nothing for an unedited document", async () => {
    await flushSave();
    expect(ops).toEqual([]);
  });

  it("creates a library file on first edit, atomically, and remembers the session", async () => {
    edit("a");
    await flushSave();
    expect(ops).toEqual(["write /docs/Papeer/Notes.inkpdf.tmp", "rename /docs/Papeer/Notes.inkpdf.tmp -> /docs/Papeer/Notes.inkpdf"]);
    const s = useStore.getState();
    expect(s.dirty).toBe(false);
    expect(s.saveState).toBe("saved");
    expect(s.filePath).toBe("/docs/Papeer/Notes.inkpdf");
    expect(parseProject(disk.get(s.filePath!) as Uint8Array).pages[0].strokes).toHaveLength(1);
    expect(JSON.parse(disk.get("/support/com.mariushorne.papeer/session.json") as string)).toEqual({ files: [s.filePath], active: 0 });
  });

  it("does not overwrite an existing library file with the same name", async () => {
    disk.set("/docs/Papeer/Notes.inkpdf", new Uint8Array());
    edit("a");
    await flushSave();
    expect(useStore.getState().filePath).toBe("/docs/Papeer/Notes 2.inkpdf");
  });

  it("saves edits made while a save is in flight", async () => {
    edit("a");
    const first = flushSave();
    edit("b"); // lands during the first write
    void flushSave();
    await first;
    const s = useStore.getState();
    expect(s.dirty).toBe(false);
    expect(parseProject(disk.get(s.filePath!) as Uint8Array).pages[0].strokes.map((x) => x.id)).toEqual(["a", "b"]);
  });

  it("reports failures and keeps the document dirty", async () => {
    failWrites = true;
    edit("a");
    await flushSave();
    expect(useStore.getState().saveState).toBe("error");
    expect(useStore.getState().dirty).toBe(true);
  });

  it("reopens the last document on launch", async () => {
    edit("a");
    await flushSave();
    const path = useStore.getState().filePath;
    useStore.getState().loadDoc({ pages: [blankPage()], pdfBytes: null, pdf: null, filePath: null, name: "Untitled" });
    expect(await restoreLastSession()).toBe(true);
    const s = useStore.getState();
    expect(s.filePath).toBe(path);
    expect(s.pages[0].strokes.map((x) => x.id)).toEqual(["a"]);
  });
});

describe("tabs", () => {
  const ids = () => useStore.getState().pages[0].strokes.map((x) => x.id);
  const open = (name: string) =>
    useStore.getState().loadDoc({ pages: [blankPage()], pdfBytes: null, pdf: null, filePath: null, name }, { newTab: true });

  it("keeps each tab's pages, history and file separate", async () => {
    edit("a");
    await flushSave();
    open("Other");
    edit("b");
    await flushSave();
    const st = useStore.getState;
    expect(st().tabs).toHaveLength(2);
    expect(ids()).toEqual(["b"]);
    st().switchTab(0, 0);
    expect(ids()).toEqual(["a"]);
    expect(st().filePath).toBe("/docs/Papeer/Notes.inkpdf");
    st().undo();
    expect(ids()).toEqual([]);
    st().switchTab(1, 0);
    expect(ids()).toEqual(["b"]);
    expect(st().filePath).toBe("/docs/Papeer/Other.inkpdf");
  });

  it("remembers every open file and reopens them as tabs", async () => {
    edit("a");
    await flushSave();
    open("Other");
    edit("b");
    await flushSave();
    useStore.getState().switchTab(0, 0);
    await flushSave(); // session is written on save/tab events; force one here
    const session = { files: ["/docs/Papeer/Notes.inkpdf", "/docs/Papeer/Other.inkpdf"], active: 0 };
    disk.set("/support/com.mariushorne.papeer/session.json", JSON.stringify(session));

    while (useStore.getState().tabs.length > 1) useStore.getState().closeTab(0);
    useStore.getState().closeTab(0);
    expect(await restoreLastSession()).toBe(true);
    const s = useStore.getState();
    expect(s.tabs).toHaveLength(2);
    expect(s.activeTab).toBe(0);
    expect(ids()).toEqual(["a"]);
  });

  it("closing the active tab shows a neighbour; closing the last leaves a blank page", () => {
    edit("a");
    open("Other");
    edit("b");
    const st = useStore.getState;
    st().closeTab(1);
    expect(st().tabs).toHaveLength(1);
    expect(ids()).toEqual(["a"]);
    st().closeTab(0);
    expect(st().tabs).toHaveLength(1);
    expect(st().pages[0].strokes).toHaveLength(0);
    expect(st().name).toBe("Untitled");
  });
});

describe("migration from the old app name", () => {
  const oldDoc = "/docs/Tablet PDF Writer/Notes.inkpdf";
  const oldSession = "/support/com.mariushorne.tabletpdfwriter/session.json";
  const project = () => {
    const page = blankPage();
    return serializeProject({ pages: [{ ...page, strokes: [stroke("old")] }], pdfBytes: null });
  };

  it("moves the library folder and reopens the old session's documents", async () => {
    disk.set(oldDoc, project());
    disk.set(oldSession, JSON.stringify({ files: [oldDoc], active: 0 }));
    expect(await restoreLastSession()).toBe(true);
    expect(useStore.getState().filePath).toBe("/docs/Papeer/Notes.inkpdf");
    expect(useStore.getState().pages[0].strokes.map((x) => x.id)).toEqual(["old"]);
    expect(disk.has(oldDoc)).toBe(false);
    expect(disk.has(oldSession)).toBe(true); // the old app's data is left alone
  });

  it("never overwrites an existing Papeer library", async () => {
    disk.set(oldDoc, project());
    disk.set("/docs/Papeer/Mine.inkpdf", project());
    disk.set(oldSession, JSON.stringify({ files: [oldDoc], active: 0 }));
    expect(await restoreLastSession()).toBe(true);
    expect(disk.has(oldDoc)).toBe(true);
    expect(useStore.getState().filePath).toBe(oldDoc);
  });
});
