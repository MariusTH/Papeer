import { appDataDir, documentDir, join } from "@tauri-apps/api/path";
import { exists, mkdir, readFile, readTextFile, rename, writeFile, writeTextFile } from "@tauri-apps/plugin-fs";
import { isTauri } from "../platform";
import { PROJECT_EXT } from "./project";

/**
 * Where autosaved documents live. Desktop: real files in ~/Documents/Tablet PDF Writer/.
 * Web: the browser's localStorage (for testing; limited to a few MB per site).
 */
export interface DocStore {
  /** A free path for a new document called `name`. */
  newPath(name: string): Promise<string>;
  /** Write so the stored document is always either the old or the new complete version. */
  write(path: string, bytes: Uint8Array): Promise<void>;
  read(path: string): Promise<Uint8Array | null>;
  readSession(): Promise<string | null>;
  writeSession(json: string): Promise<void>;
}

const safeName = (name: string) => name.replace(/[\\/:*?"<>|]/g, "-").trim() || "Untitled";

export const libraryDir = async () => join(await documentDir(), "Tablet PDF Writer");

export const fileStore: DocStore = {
  async newPath(name) {
    const dir = await libraryDir();
    if (!(await exists(dir))) await mkdir(dir, { recursive: true });
    for (let i = 1; ; i++) {
      const path = await join(dir, `${safeName(name)}${i > 1 ? ` ${i}` : ""}.${PROJECT_EXT}`);
      if (!(await exists(path))) return path;
    }
  },
  async write(path, bytes) {
    const tmp = `${path}.tmp`;
    await writeFile(tmp, bytes);
    await rename(tmp, path);
  },
  async read(path) {
    return (await exists(path)) ? readFile(path) : null;
  },
  async readSession() {
    const f = await join(await appDataDir(), "session.json");
    return (await exists(f)) ? readTextFile(f) : null;
  },
  async writeSession(json) {
    const dir = await appDataDir();
    if (!(await exists(dir))) await mkdir(dir, { recursive: true });
    await writeTextFile(await join(dir, "session.json"), json);
  },
};

/** Prefix for documents kept in browser storage; reads like a folder so names display normally. */
export const WEB_DIR = "browser";
const DOC_KEY = (path: string) => `tpw:doc:${path}`;
const SESSION_KEY = "tpw:session";

function toBase64(bytes: Uint8Array) {
  let s = "";
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(s);
}
function fromBase64(b64: string) {
  const s = atob(b64);
  const out = new Uint8Array(s.length);
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i);
  return out;
}

function setItem(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch (e) {
    if (e instanceof DOMException && /quota/i.test(e.name + e.message)) {
      throw new Error("Browser storage is full. Use Save As to download a copy, then close some documents.");
    }
    throw e;
  }
}

export const webStore: DocStore = {
  async newPath(name) {
    for (let i = 1; ; i++) {
      const path = `${WEB_DIR}/${safeName(name)}${i > 1 ? ` ${i}` : ""}.${PROJECT_EXT}`;
      if (localStorage.getItem(DOC_KEY(path)) === null) return path;
    }
  },
  // A single setItem either fully succeeds or leaves the old value: already atomic.
  async write(path, bytes) {
    setItem(DOC_KEY(path), toBase64(bytes));
  },
  async read(path) {
    const v = localStorage.getItem(DOC_KEY(path));
    return v === null ? null : fromBase64(v);
  },
  async readSession() {
    return localStorage.getItem(SESSION_KEY);
  },
  async writeSession(json) {
    setItem(SESSION_KEY, json);
  },
};

let override: DocStore | null = null;
/** For tests: force a specific store. */
export const setDocStore = (s: DocStore | null) => {
  override = s;
};
export const docStore = (): DocStore => override ?? (isTauri ? fileStore : webStore);
