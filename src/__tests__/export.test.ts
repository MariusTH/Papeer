import { describe, expect, it } from "vitest";
import { degrees, PDFDocument } from "pdf-lib";
import { parseProject, serializeProject } from "../io/project";
import { addStroke } from "../model/ops";
import { Page, Stroke } from "../model/types";
import { exportPdf } from "../pdf/export";

async function samplePdf(): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.addPage([600, 800]).drawText("Hello", { x: 50, y: 700 });
  doc.addPage([400, 500]).drawText("Page 2", { x: 50, y: 400 });
  const rotated = doc.addPage([300, 200]);
  rotated.drawText("Rotated", { x: 20, y: 100 });
  rotated.setRotation(degrees(90));
  doc.addPage([300, 300]); // empty page without a content stream
  return doc.save();
}

const ink = (id: string, y0: number, y1: number): Stroke => ({
  id,
  tool: id.startsWith("h") ? "highlighter" : "pen",
  color: "#1d4ed8",
  size: 3,
  points: [
    { x: 40, y: y0, p: 0.3 },
    { x: 80, y: (y0 + y1) / 2, p: 0.7 },
    { x: 120, y: y1, p: 0.5 },
  ],
});

function pagesFor(): Page[] {
  return [
    { id: "p1", source: { pdfPageIndex: 0 }, width: 600, baseHeight: 800, extraHeight: 0, strokes: [] },
    { id: "p2", source: { pdfPageIndex: 1 }, width: 400, baseHeight: 500, extraHeight: 0, strokes: [] },
    { id: "p3", source: { pdfPageIndex: 2 }, width: 200, baseHeight: 300, extraHeight: 0, strokes: [] },
    { id: "empty", source: { pdfPageIndex: 3 }, width: 300, baseHeight: 300, extraHeight: 0, strokes: [] },
    { id: "blank", source: null, width: 595, baseHeight: 842, extraHeight: 0, strokes: [] },
  ];
}

describe("exportPdf", () => {
  it("exports pages with varying heights, including extensions", async () => {
    const src = await samplePdf();
    let pages = pagesFor();
    // Write past the bottom of page 1 → it grows.
    pages = addStroke(pages, "p1", ink("a", 780, 1100));
    pages = addStroke(pages, "p2", ink("h1", 100, 120));
    pages = addStroke(pages, "blank", ink("b", 100, 200));
    const extended = pages[0].baseHeight + pages[0].extraHeight;
    expect(extended).toBeGreaterThan(1100);

    const out = await PDFDocument.load(await exportPdf(pages, src, { trim: false }));
    expect(out.getPageCount()).toBe(5);
    const sizes = out.getPages().map((p) => p.getSize());
    expect(sizes[0]).toEqual({ width: 600, height: extended });
    expect(sizes[1]).toEqual({ width: 400, height: 500 });
    expect(sizes[2]).toEqual({ width: 200, height: 300 }); // rotated source displayed as 200×300
    expect(sizes[3]).toEqual({ width: 300, height: 300 });
    expect(sizes[4]).toEqual({ width: 595, height: 842 });
  });

  it("trims unused extension on export", async () => {
    const src = await samplePdf();
    const pages = pagesFor();
    pages[1] = { ...pages[1], extraHeight: 3000, strokes: [ink("a", 520, 560)] };
    const out = await PDFDocument.load(await exportPdf(pages, src, { trim: true }));
    const h = out.getPage(1).getHeight();
    expect(h).toBeGreaterThan(560);
    expect(h).toBeLessThan(700);
  });

  it("never exports margin notes", async () => {
    const pages = [pagesFor()[4]];
    const plain = await exportPdf(pages, null);
    const withNotes = await exportPdf([{ ...pages[0], notes: [ink("n", 100, 200)] }], null);
    expect(withNotes.length).toBe(plain.length);
  });

  it("exports blank notebooks without a source PDF", async () => {
    const pages = [pagesFor()[4]];
    const out = await PDFDocument.load(await exportPdf(pages, null));
    expect(out.getPageCount()).toBe(1);
  });
});

describe("project file", () => {
  it("round-trips pages and original PDF", async () => {
    const src = await samplePdf();
    const pages = addStroke(pagesFor(), "p1", ink("a", 10, 50));
    const parsed = parseProject(serializeProject({ pages, pdfBytes: src }));
    expect(parsed.pages).toEqual(pages);
    expect(Array.from(parsed.pdfBytes!)).toEqual(Array.from(src));
  });

  it("round-trips margin notes", () => {
    const pages: Page[] = [{ ...pagesFor()[4], notes: [ink("n", 100, 200)] }];
    expect(parseProject(serializeProject({ pages, pdfBytes: null })).pages).toEqual(pages);
  });

  it("round-trips a blank notebook", () => {
    const pages = [pagesFor()[4]];
    const parsed = parseProject(serializeProject({ pages, pdfBytes: null }));
    expect(parsed.pdfBytes).toBeNull();
    expect(parsed.pages).toEqual(pages);
  });
});
