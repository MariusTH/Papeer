import { Point, Stroke } from "../model/types";

export interface Rect {
  x: number;
  y: number;
  w: number;
  h: number;
}

export function distToSegment(px: number, py: number, ax: number, ay: number, bx: number, by: number) {
  const dx = bx - ax;
  const dy = by - ay;
  const len2 = dx * dx + dy * dy;
  let t = len2 ? ((px - ax) * dx + (py - ay) * dy) / len2 : 0;
  t = Math.max(0, Math.min(1, t));
  return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
}

export function strokeBounds(strokes: Stroke[]): Rect | null {
  let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
  for (const s of strokes) {
    const r = s.size / 2;
    for (const p of s.points) {
      x0 = Math.min(x0, p.x - r);
      y0 = Math.min(y0, p.y - r);
      x1 = Math.max(x1, p.x + r);
      y1 = Math.max(y1, p.y + r);
    }
  }
  return x0 === Infinity ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
}

export const rectContains = (r: Rect, x: number, y: number, pad = 0) =>
  x >= r.x - pad && x <= r.x + r.w + pad && y >= r.y - pad && y <= r.y + r.h + pad;

/** True if a circle of `radius` at (x, y) touches the stroke. */
export function strokeHit(s: Stroke, x: number, y: number, radius: number): boolean {
  const r = radius + s.size / 2;
  const b = strokeBounds([s]);
  if (!b || !rectContains(b, x, y, radius)) return false;
  const pts = s.points;
  if (pts.length === 1) return Math.hypot(pts[0].x - x, pts[0].y - y) <= r;
  for (let i = 1; i < pts.length; i++) {
    if (distToSegment(x, y, pts[i - 1].x, pts[i - 1].y, pts[i].x, pts[i].y) <= r) return true;
  }
  return false;
}

/** IDs of strokes touched by an eraser moving from a to b. */
export function erasedBy(strokes: Stroke[], a: Point, b: Point, radius: number): string[] {
  const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, radius)));
  const hit: string[] = [];
  for (const s of strokes) {
    for (let i = 0; i <= steps; i++) {
      const t = i / steps;
      if (strokeHit(s, a.x + (b.x - a.x) * t, a.y + (b.y - a.y) * t, radius)) {
        hit.push(s.id);
        break;
      }
    }
  }
  return hit;
}

export function pointInPolygon(x: number, y: number, poly: { x: number; y: number }[]): boolean {
  let inside = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const xi = poly[i].x, yi = poly[i].y, xj = poly[j].x, yj = poly[j].y;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}

/** Strokes with at least half their points inside the lasso polygon. */
export function strokesInLasso(strokes: Stroke[], poly: { x: number; y: number }[]): string[] {
  if (poly.length < 3) return [];
  return strokes
    .filter((s) => {
      const inside = s.points.filter((p) => pointInPolygon(p.x, p.y, poly)).length;
      return inside > 0 && inside >= s.points.length / 2;
    })
    .map((s) => s.id);
}
