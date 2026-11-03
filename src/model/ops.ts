import { blankPage, Page, pageHeight, Stroke } from "./types";

/** Writing within this distance of the bottom grows the page. */
export const EXTEND_THRESHOLD = 120;
/** Minimum amount of space added when a page grows. */
export const EXTEND_AMOUNT = 400;

const mapPage = (pages: Page[], pageId: string, fn: (p: Page) => Page) =>
  pages.map((p) => (p.id === pageId ? fn(p) : p));

/** Extra height needed so that content reaching `maxY` keeps room below it. */
export function extensionFor(page: Page, maxY: number): number {
  const h = pageHeight(page);
  if (maxY < h - EXTEND_THRESHOLD) return 0;
  return Math.max(EXTEND_AMOUNT, maxY - h + EXTEND_AMOUNT);
}

export function strokeMaxY(strokes: Stroke[]): number {
  let m = -Infinity;
  for (const s of strokes) for (const pt of s.points) m = Math.max(m, pt.y + s.size / 2);
  return m;
}

/** A stroke belongs to the notes margin when its horizontal center lies right of the page edge. */
export function isNoteStroke(page: Page, s: Stroke): boolean {
  let min = Infinity;
  let max = -Infinity;
  for (const pt of s.points) {
    if (pt.x < min) min = pt.x;
    if (pt.x > max) max = pt.x;
  }
  return (min + max) / 2 > page.width;
}

/** Page ink followed by margin notes. */
export const allInk = (p: Page): Stroke[] => (p.notes?.length ? [...p.strokes, ...p.notes] : p.strokes);

/** Re-sorts strokes into page ink and margin notes. */
function withInk(p: Page, all: Stroke[]): Page {
  const strokes: Stroke[] = [];
  const notes: Stroke[] = [];
  for (const s of all) (isNoteStroke(p, s) ? notes : strokes).push(s);
  return { ...p, strokes, notes };
}

/** Adds a stroke (to the page or its notes margin) and auto-extends the page near the bottom. */
export function addStroke(pages: Page[], pageId: string, stroke: Stroke): Page[] {
  return mapPage(pages, pageId, (p) => {
    const note = isNoteStroke(p, stroke);
    return {
      ...p,
      strokes: note ? p.strokes : [...p.strokes, stroke],
      notes: note ? [...(p.notes ?? []), stroke] : p.notes,
      extraHeight: p.extraHeight + extensionFor(p, strokeMaxY([stroke])),
    };
  });
}

export function removeStrokes(pages: Page[], pageId: string, ids: Set<string>): Page[] {
  return mapPage(pages, pageId, (p) => ({
    ...p,
    strokes: p.strokes.filter((s) => !ids.has(s.id)),
    notes: p.notes?.filter((s) => !ids.has(s.id)),
  }));
}

/** Translates strokes by (dx, dy), clamping so nothing goes above the page top. */
export function moveStrokes(
  pages: Page[],
  pageId: string,
  ids: Set<string>,
  dx: number,
  dy: number,
): Page[] {
  return mapPage(pages, pageId, (p) => {
    const all = allInk(p).map((s) =>
      ids.has(s.id)
        ? { ...s, points: s.points.map((pt) => ({ ...pt, x: pt.x + dx, y: pt.y + dy })) }
        : s,
    );
    const moved = all.filter((s) => ids.has(s.id));
    // Dragging ink across the page edge moves it between the page and the notes margin.
    return { ...withInk(p, all), extraHeight: p.extraHeight + extensionFor(p, strokeMaxY(moved)) };
  });
}

export function insertBlankPageAfter(pages: Page[], index: number): Page[] {
  const ref = pages[index] ?? pages[pages.length - 1];
  const page = ref ? blankPage(ref.width, ref.baseHeight) : blankPage();
  const at = Math.min(Math.max(index + 1, 0), pages.length);
  return [...pages.slice(0, at), page, ...pages.slice(at)];
}

export function deletePage(pages: Page[], pageId: string): Page[] {
  const next = pages.filter((p) => p.id !== pageId);
  return next.length ? next : [blankPage()];
}

/** Shrinks unused extension space down to the lowest stroke plus a margin. */
export function trimExtension(page: Page, margin = 40): Page {
  if (page.extraHeight === 0) return page;
  const maxY = strokeMaxY(page.strokes);
  const needed = Math.max(0, maxY + margin - page.baseHeight);
  return { ...page, extraHeight: Math.min(page.extraHeight, Math.ceil(needed)) };
}
