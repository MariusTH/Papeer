/** All coordinates are PDF points, page-local, y-down from the page top. */
export interface Point {
  x: number;
  y: number;
  /** Pressure 0..1 */
  p: number;
}

export type InkTool = "pen" | "highlighter";
/** Pen tip; decides how pressure shapes the line. See ink/brushes.ts. */
export type BrushId = "fineliner" | "ballpoint" | "fountain" | "brush" | "pencil";
export type Tool = InkTool | "eraser" | "lasso";

export interface Stroke {
  id: string;
  tool: InkTool;
  color: string; // #rrggbb
  size: number; // nominal width in points
  /** Pen tip for pen strokes; absent on strokes made before brushes existed. */
  brush?: BrushId;
  points: Point[];
}

export interface Page {
  id: string;
  /** Index into the original PDF, or null for a blank page. */
  source: { pdfPageIndex: number } | null;
  width: number;
  baseHeight: number;
  /** Extra writing space appended below the original page. */
  extraHeight: number;
  strokes: Stroke[];
  /**
   * Margin notes, drawn to the right of the page (x > width). Kept in the project
   * file only — never exported to the PDF. Optional for files saved before notes existed.
   */
  notes?: Stroke[];
}

/** Width of the notes margin, in PDF points. */
export const NOTES_WIDTH = 340;
/** Space between the page and its notes margin, in PDF points. */
export const NOTES_GAP = 14;

export const pageHeight = (p: Page) => p.baseHeight + p.extraHeight;

export const A4 = { width: 595.28, height: 841.89 };

let counter = 0;
export const newId = () =>
  `${Date.now().toString(36)}-${(counter++).toString(36)}-${Math.random().toString(36).slice(2, 7)}`;

export const blankPage = (width = A4.width, height = A4.height): Page => ({
  id: newId(),
  source: null,
  width,
  baseHeight: height,
  extraHeight: 0,
  strokes: [],
});
