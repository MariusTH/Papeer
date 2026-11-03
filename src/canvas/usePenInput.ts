import { PointerEvent as ReactPointerEvent, RefObject, useRef } from "react";
import { erasedBy, rectContains, strokeBounds, strokesInLasso } from "../ink/hitTest";
import { addStroke, allInk, moveStrokes, removeStrokes } from "../model/ops";
import { currentSize, effectiveTool, useStore } from "../model/store";
import { newId, Page, Point, Stroke, Tool } from "../model/types";
import { pressureCurve } from "../ink/brushes";
import { isEraserEvent, isPenEvent, pressureFor } from "./tablet";

export type Gesture =
  | { kind: "ink"; stroke: Stroke }
  | { kind: "erase"; last: Point; removed: Set<string> }
  | { kind: "lasso"; poly: Point[] }
  | { kind: "move"; start: Point; base: Page[]; ids: Set<string> };

/** Pen eraser end (native proximity, button 5 / buttons bit 32) or barrel button erases. */
function toolFor(e: ReactPointerEvent, tool: Tool): Tool {
  return isEraserEvent(e) ? "eraser" : tool;
}

export function usePenInput(
  page: Page,
  containerRef: RefObject<HTMLDivElement | null>,
  redrawLive: () => void,
) {
  const gesture = useRef<Gesture | null>(null);
  const hover = useRef<Point | null>(null);
  const activeTool = useRef<Tool>("pen");
  const pageRef = useRef(page);
  pageRef.current = page;

  const toPoint = (e: { clientX: number; clientY: number; pressure: number; pointerType: string }): Point => {
    const rect = containerRef.current!.getBoundingClientRect();
    const { zoom, pressure } = useStore.getState();
    return {
      x: (e.clientX - rect.left) / zoom,
      y: (e.clientY - rect.top) / zoom,
      p: pressureCurve(pressureFor(e), pressure),
    };
  };

  const samples = (e: ReactPointerEvent): Point[] => {
    const native = e.nativeEvent as PointerEvent;
    const list = typeof native.getCoalescedEvents === "function" ? native.getCoalescedEvents() : [];
    return (list.length ? list : [native]).map(toPoint);
  };

  const eraseAlong = (a: Point, b: Point, g: Extract<Gesture, { kind: "erase" }>) => {
    const s = useStore.getState();
    const current = s.pages.find((p) => p.id === pageRef.current.id);
    if (!current) return;
    const ink = s.showNotes ? allInk(current) : current.strokes;
    const hits = erasedBy(ink, a, b, currentSize(s, "eraser"));
    if (!hits.length) return;
    hits.forEach((id) => g.removed.add(id));
    s.setTransient(removeStrokes(s.pages, current.id, new Set(hits)));
  };

  const onPointerDown = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return; // palm rejection: fingers never draw
    if (!isPenEvent(e) && e.button !== 0) return;
    e.preventDefault();
    try {
      e.currentTarget.setPointerCapture(e.pointerId);
    } catch {
      // Capture can fail for some synthetic/driver events; drawing still works without it.
    }

    const s = useStore.getState();
    const tool = toolFor(e, effectiveTool(s));
    activeTool.current = tool;
    const pt = toPoint(e);
    const pageId = pageRef.current.id;

    if (tool !== "lasso" && s.selection) s.setSelection(null);

    switch (tool) {
      case "pen":
      case "highlighter":
        gesture.current = {
          kind: "ink",
          stroke: {
            id: newId(),
            tool,
            color: s.colors[tool],
            size: currentSize(s, tool),
            ...(tool === "pen" ? { brush: s.brush } : {}),
            points: [pt],
          },
        };
        break;
      case "eraser": {
        s.begin();
        const g = { kind: "erase" as const, last: pt, removed: new Set<string>() };
        gesture.current = g;
        eraseAlong(pt, pt, g);
        break;
      }
      case "lasso": {
        const sel = s.selection;
        if (sel && sel.pageId === pageId) {
          const ids = new Set(sel.ids);
          const bounds = strokeBounds(allInk(pageRef.current).filter((st) => ids.has(st.id)));
          if (bounds && rectContains(bounds, pt.x, pt.y, 8)) {
            s.begin();
            gesture.current = { kind: "move", start: pt, base: s.pages, ids };
            break;
          }
        }
        s.setSelection(null);
        gesture.current = { kind: "lasso", poly: [pt] };
        break;
      }
    }
    redrawLive();
  };

  const onPointerMove = (e: ReactPointerEvent<HTMLDivElement>) => {
    if (e.pointerType === "touch") return;
    const g = gesture.current;
    if (!g) {
      hover.current = toPoint(e);
      if (effectiveTool(useStore.getState()) === "eraser") redrawLive();
      return;
    }
    const pts = samples(e);
    hover.current = pts[pts.length - 1];
    switch (g.kind) {
      case "ink": {
        const arr = g.stroke.points;
        for (const p of pts) {
          const last = arr[arr.length - 1];
          if (Math.hypot(p.x - last.x, p.y - last.y) >= 0.1) arr.push(p);
        }
        break;
      }
      case "erase":
        for (const p of pts) {
          eraseAlong(g.last, p, g);
          g.last = p;
        }
        break;
      case "lasso":
        g.poly.push(...pts);
        break;
      case "move": {
        const p = pts[pts.length - 1];
        const s = useStore.getState();
        s.setTransient(moveStrokes(g.base, pageRef.current.id, g.ids, p.x - g.start.x, p.y - g.start.y));
        break;
      }
    }
    redrawLive();
  };

  const finish = () => {
    const g = gesture.current;
    gesture.current = null;
    if (!g) return;
    const s = useStore.getState();
    const pageId = pageRef.current.id;
    switch (g.kind) {
      case "ink":
        s.commit(addStroke(s.pages, pageId, g.stroke));
        break;
      case "erase":
      case "move":
        s.end();
        break;
      case "lasso": {
        const current = s.pages.find((p) => p.id === pageId);
        const ink = current ? (s.showNotes ? allInk(current) : current.strokes) : [];
        const ids = strokesInLasso(ink, g.poly);
        s.setSelection(ids.length ? { pageId, ids } : null);
        break;
      }
    }
    redrawLive();
  };

  const onPointerLeave = () => {
    hover.current = null;
    if (!gesture.current) redrawLive();
  };

  return {
    gesture,
    hover,
    activeTool,
    handlers: { onPointerDown, onPointerMove, onPointerUp: finish, onPointerCancel: finish, onPointerLeave },
  };
}
