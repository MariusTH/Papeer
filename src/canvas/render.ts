import { styleOf } from "../ink/brushes";
import { strokeSvgPath } from "../ink/outline";
import { Rect } from "../ink/hitTest";
import { Stroke } from "../model/types";

const pathCache = new WeakMap<Stroke, Path2D>();

function strokePath(s: Stroke): Path2D {
  let p = pathCache.get(s);
  if (!p) {
    p = new Path2D(strokeSvgPath(s));
    pathCache.set(s, p);
  }
  return p;
}

const MAX_DIM = 16384;
const MAX_AREA = 48e6;

/** Device pixels per PDF point for a canvas of w×h points, capped to stay within WebKit canvas limits. */
export function backingScale(w: number, h: number, zoom: number) {
  let s = zoom * (window.devicePixelRatio || 1);
  s = Math.min(s, MAX_DIM / w, MAX_DIM / h, Math.sqrt(MAX_AREA / (w * h)));
  return Math.max(s, 0.1);
}

/** Resize the backing store (if needed) and return a context scaled to PDF points. */
export function prepareCanvas(c: HTMLCanvasElement, w: number, h: number, scale: number) {
  const pw = Math.max(1, Math.round(w * scale));
  const ph = Math.max(1, Math.round(h * scale));
  if (c.width !== pw || c.height !== ph) {
    c.width = pw;
    c.height = ph;
  }
  const ctx = c.getContext("2d")!;
  ctx.setTransform(1, 0, 0, 1, 0, 0);
  ctx.clearRect(0, 0, pw, ph);
  ctx.setTransform(pw / w, 0, 0, ph / h, 0, 0);
  return ctx;
}

export function drawStroke(ctx: CanvasRenderingContext2D, s: Stroke, path?: Path2D) {
  const hl = s.tool === "highlighter";
  ctx.globalAlpha = styleOf(s).opacity;
  ctx.globalCompositeOperation = hl ? "multiply" : "source-over";
  ctx.fillStyle = s.color;
  ctx.fill(path ?? strokePath(s));
  ctx.globalAlpha = 1;
  ctx.globalCompositeOperation = "source-over";
}

export function drawStrokes(ctx: CanvasRenderingContext2D, strokes: Stroke[]) {
  // Highlighter first so ink sits on top of it, like a real marker under pen.
  for (const s of strokes) if (s.tool === "highlighter") drawStroke(ctx, s);
  for (const s of strokes) if (s.tool !== "highlighter") drawStroke(ctx, s);
}

export function drawLiveStroke(ctx: CanvasRenderingContext2D, s: Stroke) {
  drawStroke(ctx, s, new Path2D(strokeSvgPath(s, false)));
}

export function drawSelection(ctx: CanvasRenderingContext2D, r: Rect, zoom: number) {
  const pad = 6;
  ctx.save();
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([6 / zoom, 4 / zoom]);
  ctx.strokeStyle = "#2563eb";
  ctx.fillStyle = "rgba(37, 99, 235, 0.06)";
  ctx.fillRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2);
  ctx.strokeRect(r.x - pad, r.y - pad, r.w + pad * 2, r.h + pad * 2);
  ctx.restore();
}

export function drawLasso(ctx: CanvasRenderingContext2D, poly: { x: number; y: number }[], zoom: number) {
  if (poly.length < 2) return;
  ctx.save();
  ctx.lineWidth = 1.5 / zoom;
  ctx.setLineDash([5 / zoom, 4 / zoom]);
  ctx.strokeStyle = "#2563eb";
  ctx.fillStyle = "rgba(37, 99, 235, 0.06)";
  ctx.beginPath();
  ctx.moveTo(poly[0].x, poly[0].y);
  for (const p of poly) ctx.lineTo(p.x, p.y);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();
  ctx.restore();
}

export function drawEraserCursor(ctx: CanvasRenderingContext2D, x: number, y: number, r: number, zoom: number) {
  ctx.save();
  ctx.lineWidth = 1 / zoom;
  ctx.strokeStyle = "rgba(0,0,0,0.5)";
  ctx.beginPath();
  ctx.arc(x, y, r, 0, Math.PI * 2);
  ctx.stroke();
  ctx.restore();
}
