import { open, save } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import { isTauri } from "../platform";
import { PROJECT_EXT } from "./project";

export interface PickedFile {
  /** Full path on desktop; just the file name on the web. */
  path: string;
  bytes: Uint8Array;
}

/** Lets the user choose a PDF or project to open. */
export async function pickOpenFile(defaultPath?: string): Promise<PickedFile | null> {
  if (!isTauri) return pickInBrowser();
  const path = await open({
    defaultPath,
    multiple: false,
    directory: false,
    filters: [{ name: "PDF or Ink project", extensions: ["pdf", PROJECT_EXT] }],
  });
  if (!path || Array.isArray(path)) return null;
  return { path, bytes: await readFile(path) };
}

function pickInBrowser(): Promise<PickedFile | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    input.accept = `.pdf,.${PROJECT_EXT},application/pdf`;
    input.onchange = async () => {
      const f = input.files?.[0];
      resolve(f ? { path: f.name, bytes: new Uint8Array(await f.arrayBuffer()) } : null);
    };
    input.oncancel = () => resolve(null);
    input.click();
  });
}

/**
 * Saves bytes to a user-chosen file. Desktop: save dialog, returns the chosen path.
 * Web: browser download, returns null (there is no path to keep).
 */
export async function saveFileAs(kind: "project" | "pdf", fileName: string, bytes: Uint8Array): Promise<string | null> {
  const ext = kind === "project" ? PROJECT_EXT : "pdf";
  if (!isTauri) {
    const blob = new Blob([bytes as BlobPart], { type: kind === "pdf" ? "application/pdf" : "application/octet-stream" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = fileName.toLowerCase().endsWith(`.${ext}`) ? fileName : `${fileName}.${ext}`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
    return null;
  }
  let path = await save({
    defaultPath: fileName,
    filters: [{ name: kind === "project" ? "Ink project" : "PDF", extensions: [ext] }],
  });
  if (!path) return null;
  if (!path.toLowerCase().endsWith(`.${ext}`)) path += `.${ext}`;
  await writeFile(path, bytes);
  return path;
}

export const baseName = (path: string) => path.split(/[\\/]/).pop() ?? path;
export const stripExt = (name: string) => name.replace(/\.[^.]+$/, "");
