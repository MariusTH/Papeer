import { describe, expect, it } from "vitest";
import { emptyHistory, record, redo, undo } from "../model/history";
import { addStroke, EXTEND_AMOUNT, insertBlankPageAfter, moveStrokes, removeStrokes, trimExtension } from "../model/ops";
import { blankPage, pageHeight, Stroke } from "../model/types";
import { erasedBy, strokesInLasso } from "../ink/hitTest";
import { splinePoints } from "../ink/outline";
import { HIGHLIGHTER_OPACITY, pressureCurve, styleOf } from "../ink/brushes";

const stroke = (id: string, pts: [number, number][], size = 2): Stroke => ({
  id,
  tool: "pen",
  color: "#000000",
  size,
  points: pts.map(([x, y]) => ({ x, y, p: 0.5 })),
});

describe("auto-extend", () => {
  it("does not extend for strokes in the middle of the page", () => {
    const page = blankPage(600, 800);
    const [p] = addStroke([page], page.id, stroke("a", [[10, 100], [50, 120]]));
    expect(p.extraHeight).toBe(0);
  });

  it("extends when writing near the bottom", () => {
    const page = blankPage(600, 800);
    const [p] = addStroke([page], page.id, stroke("a", [[10, 760], [50, 770]]));
    expect(p.extraHeight).toBe(EXTEND_AMOUNT);
    expect(pageHeight(p)).toBe(800 + EXTEND_AMOUNT);
  });

  it("extends enough when writing far past the bottom", () => {
    const page = blankPage(600, 800);
    const [p] = addStroke([page], page.id, stroke("a", [[10, 790], [10, 1500]]));
    expect(pageHeight(p)).toBeGreaterThan(1500 + 100);
  });

  it("trims unused extension", () => {
    const page = { ...blankPage(600, 800), extraHeight: 2000 };
    const [p] = addStroke([page], page.id, stroke("a", [[10, 900]]));
    expect(trimExtension(p).extraHeight).toBeLessThan(200);
    expect(trimExtension({ ...page, strokes: [] }).extraHeight).toBe(0);
  });
});

describe("ops", () => {
  it("removes and moves strokes", () => {
    const page = blankPage();
    let pages = addStroke([page], page.id, stroke("a", [[10, 10]]));
    pages = addStroke(pages, page.id, stroke("b", [[20, 20]]));
    pages = moveStrokes(pages, page.id, new Set(["b"]), 5, 5);
    expect(pages[0].strokes[1].points[0]).toMatchObject({ x: 25, y: 25 });
    pages = removeStrokes(pages, page.id, new Set(["a"]));
    expect(pages[0].strokes.map((s) => s.id)).toEqual(["b"]);
  });

  it("inserts a blank page after the given index", () => {
    const pages = [blankPage(), blankPage()];
    const next = insertBlankPageAfter(pages, 0);
    expect(next).toHaveLength(3);
    expect(next[0]).toBe(pages[0]);
    expect(next[2]).toBe(pages[1]);
  });
});

describe("history", () => {
  it("undoes and redoes", () => {
    const a = [blankPage()];
    const b = [blankPage()];
    let h = record(emptyHistory(), a);
    const u = undo(h, b)!;
    expect(u.pages).toBe(a);
    h = u.history;
    const r = redo(h, a)!;
    expect(r.pages).toBe(b);
    expect(undo(emptyHistory(), a)).toBeNull();
  });
});

describe("hit testing", () => {
  const strokes = [stroke("line", [[0, 0], [100, 0]]), stroke("far", [[0, 200], [100, 200]])];

  it("erases strokes touched by the eraser path", () => {
    expect(erasedBy(strokes, { x: 50, y: -20, p: 0 }, { x: 50, y: 20, p: 0 }, 4)).toEqual(["line"]);
    expect(erasedBy(strokes, { x: 50, y: 50, p: 0 }, { x: 50, y: 60, p: 0 }, 4)).toEqual([]);
  });

  it("selects strokes inside a lasso", () => {
    const poly = [{ x: -10, y: -10 }, { x: 110, y: -10 }, { x: 110, y: 10 }, { x: -10, y: 10 }];
    expect(strokesInLasso(strokes, poly)).toEqual(["line"]);
  });
});

describe("margin notes", () => {
  it("files strokes right of the page edge as notes", () => {
    const page = blankPage(600, 800);
    let pages = addStroke([page], page.id, stroke("ink", [[100, 100], [200, 100]]));
    pages = addStroke(pages, page.id, stroke("note", [[650, 100], [800, 120]]));
    expect(pages[0].strokes.map((s) => s.id)).toEqual(["ink"]);
    expect(pages[0].notes?.map((s) => s.id)).toEqual(["note"]);
  });

  it("notes near the bottom also grow the page", () => {
    const page = blankPage(600, 800);
    const [p] = addStroke([page], page.id, stroke("note", [[700, 780], [750, 790]]));
    expect(p.extraHeight).toBe(EXTEND_AMOUNT);
    expect(trimExtension(p).extraHeight).toBe(0); // export trims to page ink only
  });

  it("moving ink across the page edge moves it between page and notes", () => {
    const page = blankPage(600, 800);
    let pages = addStroke([page], page.id, stroke("a", [[500, 100], [560, 100]]));
    pages = moveStrokes(pages, page.id, new Set(["a"]), 200, 0);
    expect(pages[0].strokes).toHaveLength(0);
    expect(pages[0].notes?.map((s) => s.id)).toEqual(["a"]);
    pages = moveStrokes(pages, page.id, new Set(["a"]), -300, 0);
    expect(pages[0].strokes.map((s) => s.id)).toEqual(["a"]);
    expect(pages[0].notes).toHaveLength(0);
  });

  it("erases notes by id", () => {
    const page = blankPage(600, 800);
    let pages = addStroke([page], page.id, stroke("note", [[700, 100]]));
    pages = removeStrokes(pages, page.id, new Set(["note"]));
    expect(pages[0].notes).toHaveLength(0);
  });
});

describe("stroke spline", () => {
  const pts = (xy: [number, number][]) => xy.map(([x, y]) => ({ x, y, p: 0.5 }));

  it("passes through every sampled point and fills the gaps", () => {
    const src = pts([[0, 0], [4, 3], [6, 0], [9, 4], [12, 1]]);
    const out = splinePoints(src, 0.35);
    for (const p of src) expect(out).toContainEqual(p);
    for (let i = 1; i < out.length; i++) {
      expect(Math.hypot(out[i].x - out[i - 1].x, out[i].y - out[i - 1].y)).toBeLessThan(0.6);
    }
  });

  it("keeps straight lines straight", () => {
    const out = splinePoints(pts([[0, 0], [5, 0], [10, 0], [20, 0]]));
    for (const p of out) expect(Math.abs(p.y)).toBeLessThan(1e-9);
  });

  it("leaves very short strokes alone", () => {
    const src = pts([[0, 0], [1, 1]]);
    expect(splinePoints(src)).toBe(src);
  });
});

describe("brushes", () => {
  const curve = (p: number, contrast: "low" | "medium" | "high", thinStart = 0) => pressureCurve(p, { contrast, thinStart });

  it("spreads the pressure range people actually use", () => {
    expect(curve(0, "low")).toBeCloseTo(0.02);
    expect(curve(1, "low")).toBeCloseTo(1);
    expect(curve(0.5, "low")).toBeCloseTo(0.51);
    expect(curve(0.25, "high")).toBeLessThan(curve(0.25, "low"));
    expect(curve(0.65, "high")).toBeGreaterThan(curve(0.65, "low"));
  });

  it("thin start keeps light strokes thin longer, then rises linearly", () => {
    expect(curve(0.15, "low", 0.4)).toBeLessThan(curve(0.15, "low", 0));
    expect(curve(0.15, "low", 0.4)).toBeLessThan(0.12);
    // Linear after the toe: equal steps in → equal steps out.
    const a = curve(0.6, "low", 0.4), b = curve(0.7, "low", 0.4), c = curve(0.8, "low", 0.4);
    expect(b - a).toBeCloseTo(c - b);
    expect(curve(1, "low", 0.4)).toBeCloseTo(1);
    // Monotonic everywhere.
    for (let p = 0; p < 1; p += 0.01) expect(curve(p + 0.01, "medium", 0.5)).toBeGreaterThanOrEqual(curve(p, "medium", 0.5));
  });

  it("keeps the old look for strokes saved before brushes existed", () => {
    expect(styleOf({ tool: "pen" }).thinning).toBe(0.6);
    expect(styleOf({ tool: "pen", brush: "fineliner" }).thinning).toBe(0);
    expect(styleOf({ tool: "highlighter", brush: "brush" }).opacity).toBe(HIGHLIGHTER_OPACITY);
  });
});
