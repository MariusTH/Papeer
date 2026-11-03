import { getStroke } from "perfect-freehand";
import { Point, Stroke } from "../model/types";
import { styleOf } from "./brushes";

export { HIGHLIGHTER_OPACITY } from "./brushes";

/** Spacing (points) to which strokes are densified before outlining. */
const SPLINE_STEP = 0.35;

/**
 * Densifies a stroke along a centripetal Catmull-Rom spline through every sampled point.
 * Sparse samples (fast, small handwriting) then become smooth curves that still pass
 * exactly through each point the pen reported, instead of straight segments.
 */
export function splinePoints(points: Point[], step = SPLINE_STEP): Point[] {
  if (points.length < 3) return points;
  const out: Point[] = [points[0]];
  for (let i = 0; i < points.length - 1; i++) {
    const p1 = points[i];
    const p2 = points[i + 1];
    const d12 = Math.hypot(p2.x - p1.x, p2.y - p1.y);
    const n = Math.ceil(d12 / step);
    if (n > 1) {
      // Mirror the end points so the first and last segments are curved too.
      const p0 = points[i - 1] ?? { x: 2 * p1.x - p2.x, y: 2 * p1.y - p2.y, p: p1.p };
      const p3 = points[i + 2] ?? { x: 2 * p2.x - p1.x, y: 2 * p2.y - p1.y, p: p2.p };
      const t0 = 0;
      const t1 = t0 + Math.sqrt(Math.hypot(p1.x - p0.x, p1.y - p0.y)) || t0 + 1e-4;
      const t2 = t1 + Math.sqrt(d12) || t1 + 1e-4;
      const t3 = t2 + Math.sqrt(Math.hypot(p3.x - p2.x, p3.y - p2.y)) || t2 + 1e-4;
      for (let k = 1; k < n; k++) {
        const t = t1 + ((t2 - t1) * k) / n;
        const lerp = (a: Point, b: Point, ta: number, tb: number) => {
          const u = tb - ta < 1e-9 ? 0 : (t - ta) / (tb - ta);
          return { x: a.x + (b.x - a.x) * u, y: a.y + (b.y - a.y) * u };
        };
        const a1 = lerp(p0, p1, t0, t1);
        const a2 = lerp(p1, p2, t1, t2);
        const a3 = lerp(p2, p3, t2, t3);
        const b1 = { x: a1.x + (a2.x - a1.x) * ((t - t0) / (t2 - t0)), y: a1.y + (a2.y - a1.y) * ((t - t0) / (t2 - t0)) };
        const b2 = { x: a2.x + (a3.x - a2.x) * ((t - t1) / (t3 - t1)), y: a2.y + (a3.y - a2.y) * ((t - t1) / (t3 - t1)) };
        const u = (t - t1) / (t2 - t1);
        out.push({ x: b1.x + (b2.x - b1.x) * u, y: b1.y + (b2.y - b1.y) * u, p: p1.p + (p2.p - p1.p) * (k / n) });
      }
    }
    out.push(p2);
  }
  return out;
}

/** Polygon outline of a stroke. Shared by screen rendering and PDF export. */
export function strokeOutline(s: Pick<Stroke, "tool" | "size" | "points" | "brush">, complete = true): number[][] {
  const style = styleOf(s);
  const size = s.size * style.sizeScale;
  const taper = style.taper * size;
  return getStroke(
    splinePoints(s.points).map((p) => [p.x, p.y, p.p]),
    {
      size,
      thinning: style.thinning,
      // The spline already passes through every sample; don't smooth or lag behind the pen.
      smoothing: 0.2,
      streamline: s.tool === "pen" ? 0 : 0.3,
      simulatePressure: false,
      last: complete,
      start: taper ? { taper, cap: true } : { cap: true },
      end: taper && complete ? { taper, cap: true } : { cap: true },
    },
  );
}

const f = (n: number) => (Math.round(n * 100) / 100).toString();

/** Smooth SVG path (quadratic curves through midpoints) from an outline polygon. */
export function outlineToSvgPath(pts: number[][]): string {
  if (pts.length < 2) return "";
  const out: string[] = ["M", f(pts[0][0]), f(pts[0][1]), "Q"];
  for (let i = 0; i < pts.length; i++) {
    const [x0, y0] = pts[i];
    const [x1, y1] = pts[(i + 1) % pts.length];
    out.push(f(x0), f(y0), f((x0 + x1) / 2), f((y0 + y1) / 2));
  }
  out.push("Z");
  return out.join(" ");
}

export const strokeSvgPath = (s: Stroke, complete = true) => outlineToSvgPath(strokeOutline(s, complete));
