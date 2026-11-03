import * as pdfjs from "pdfjs-dist";
import type { PDFDocumentProxy } from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { newId, Page } from "../model/types";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export async function openPdfDocument(bytes: Uint8Array): Promise<PDFDocumentProxy> {
  // pdf.js transfers the buffer to its worker; give it a copy so ours stays usable.
  return pdfjs.getDocument({ data: bytes.slice() }).promise;
}

export async function pagesFromPdf(pdf: PDFDocumentProxy): Promise<Page[]> {
  const pages: Page[] = [];
  for (let i = 0; i < pdf.numPages; i++) {
    const vp = (await pdf.getPage(i + 1)).getViewport({ scale: 1 });
    pages.push({
      id: newId(),
      source: { pdfPageIndex: i },
      width: vp.width,
      baseHeight: vp.height,
      extraHeight: 0,
      strokes: [],
    });
  }
  return pages;
}
