import { strFromU8, strToU8, unzipSync, Zippable, zipSync } from "fflate";
import { Page } from "../model/types";

/** `.inkpdf` = zip { doc.json, original.pdf? } */
export const PROJECT_EXT = "inkpdf";
const VERSION = 1;

export interface ProjectData {
  pages: Page[];
  pdfBytes: Uint8Array | null;
}

export function serializeProject({ pages, pdfBytes }: ProjectData): Uint8Array {
  const files: Zippable = {
    "doc.json": strToU8(JSON.stringify({ version: VERSION, pages })),
  };
  // PDFs are already compressed; storing them uncompressed keeps frequent autosaves fast.
  if (pdfBytes) files["original.pdf"] = [pdfBytes, { level: 0 }];
  return zipSync(files, { level: 6 });
}

export function parseProject(bytes: Uint8Array): ProjectData {
  const files = unzipSync(bytes);
  const json = files["doc.json"];
  if (!json) throw new Error("Not a valid project file (doc.json missing)");
  const doc = JSON.parse(strFromU8(json));
  if (typeof doc.version !== "number" || doc.version > VERSION) {
    throw new Error(`Unsupported project version: ${doc.version}`);
  }
  return { pages: doc.pages as Page[], pdfBytes: files["original.pdf"] ?? null };
}
