import type { RenderTask } from "pdfjs-dist";
import { createContext, memo, useCallback, useContext, useEffect, useLayoutEffect, useRef, useState } from "react";
import { strokeBounds } from "../ink/hitTest";
import { allInk } from "../model/ops";
import { currentSize, effectiveTool, useStore } from "../model/store";
import { NOTES_GAP, NOTES_WIDTH, Page, pageHeight } from "../model/types";
import {
  backingScale,
  drawEraserCursor,
  drawLasso,
  drawLiveStroke,
  drawSelection,
  drawStrokes,
  prepareCanvas,
} from "./render";
import { usePenInput } from "./usePenInput";

export const ScrollRootContext = createContext<HTMLElement | null>(null);

/** Ink that can be seen and edited: page ink, plus margin notes when the margin is shown. */
export const visibleInk = (p: Page, showNotes: boolean) => (showNotes ? allInk(p) : p.strokes);
/** Total drawable width of a page row, in points. */
export const rowWidth = (p: Page, showNotes: boolean) => p.width + (showNotes ? NOTES_GAP + NOTES_WIDTH : 0);

function useDebounced<T>(value: T, ms: number): T {
  const [v, setV] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setV(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return v;
}

/** Mount canvases only for pages near the viewport. */
function useNearViewport(ref: React.RefObject<HTMLElement | null>) {
  const root = useContext(ScrollRootContext);
  const [near, setNear] = useState(false);
  useEffect(() => {
    const el = ref.current;
    if (!el || !root) return;
    const io = new IntersectionObserver(([entry]) => setNear(entry.isIntersecting), {
      root,
      rootMargin: "1000px 0px",
    });
    io.observe(el);
    return () => io.disconnect();
  }, [ref, root]);
  return near;
}

export const PageView = memo(function PageView({ page, index }: { page: Page; index: number }) {
  const zoom = useStore((s) => s.zoom);
  const pdf = useStore((s) => s.pdf);
  const tool = useStore(effectiveTool);
  const selection = useStore((s) => (s.selection?.pageId === page.id ? s.selection : null));
  const showNotes = useStore((s) => s.showNotes);

  const containerRef = useRef<HTMLDivElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const liveRef = useRef<HTMLCanvasElement>(null);
  const near = useNearViewport(containerRef);
  const renderZoom = useDebounced(zoom, 150);

  const height = pageHeight(page);
  const width = rowWidth(page, showNotes);
  const inkScale = backingScale(width, height, renderZoom);

  // Live layer: in-progress stroke, lasso, selection box, eraser cursor.
  const frame = useRef(0);
  const inputRef = useRef<ReturnType<typeof usePenInput> | null>(null);
  const drawLiveNow = useCallback(() => {
    frame.current = 0;
    const c = liveRef.current;
    const input = inputRef.current;
    if (!c || !input) return;
    const s = useStore.getState();
    const current = s.pages.find((p) => p.id === page.id) ?? page;
    const w = rowWidth(current, s.showNotes);
    const h = pageHeight(current);
    const g = input.gesture.current;
    const sel = s.selection?.pageId === page.id ? s.selection : null;
    const hv = input.hover.current;
    const eraserCursor = !!hv && (g ? input.activeTool.current === "eraser" : effectiveTool(s) === "eraser");
    if (!g && !sel && !eraserCursor) {
      // Nothing to show: keep the live layer tiny instead of a full-page bitmap (saves GPU memory).
      if (c.width !== 1) c.width = c.height = 1;
      return;
    }
    const ctx = prepareCanvas(c, w, h, backingScale(w, h, renderZoom));
    if (g?.kind === "ink") drawLiveStroke(ctx, g.stroke);
    if (g?.kind === "lasso") drawLasso(ctx, g.poly, s.zoom);
    if (sel && g?.kind !== "lasso") {
      const ids = new Set(sel.ids);
      const b = strokeBounds(allInk(current).filter((st) => ids.has(st.id)));
      if (b) drawSelection(ctx, b, s.zoom);
    }
    if (eraserCursor) drawEraserCursor(ctx, hv.x, hv.y, currentSize(s, "eraser"), s.zoom);
  }, [page, renderZoom]);
  const redrawLive = useCallback(() => {
    if (!frame.current) frame.current = requestAnimationFrame(drawLiveNow);
  }, [drawLiveNow]);

  const input = usePenInput(page, containerRef, redrawLive);
  inputRef.current = input;

  // PDF background (original page only; extension area is plain paper).
  useEffect(() => {
    const c = bgRef.current;
    if (!near || !c || !pdf || !page.source) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    const scale = backingScale(page.width, page.baseHeight, renderZoom);
    pdf.getPage(page.source.pdfPageIndex + 1).then((p) => {
      if (cancelled) return;
      const viewport = p.getViewport({ scale });
      // Render offscreen, then swap, so the old bitmap stays visible while re-rendering.
      const off = document.createElement("canvas");
      off.width = Math.round(viewport.width);
      off.height = Math.round(viewport.height);
      task = p.render({ canvas: off, canvasContext: off.getContext("2d")!, viewport });
      task.promise
        .then(() => {
          if (cancelled) return;
          c.width = off.width;
          c.height = off.height;
          const ctx = c.getContext("2d");
          if (!ctx) throw new Error("no 2d context (canvas memory limit?)");
          ctx.drawImage(off, 0, 0);
        })
        .catch((e) => {
          if (!cancelled && e?.name !== "RenderingCancelledException") console.error("page render failed", e);
        })
        .finally(() => {
          // Free the offscreen bitmap now rather than whenever GC runs (WebKit caps total canvas memory).
          off.width = off.height = 0;
        });
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [near, pdf, page.source, page.width, page.baseHeight, renderZoom]);

  // Free bitmaps as soon as a page scrolls far away.
  useLayoutEffect(() => {
    if (!near) return;
    const cs = [bgRef.current, inkRef.current, liveRef.current];
    return () => {
      for (const c of cs) if (c) c.width = c.height = 0;
    };
  }, [near]);

  // Committed ink.
  useLayoutEffect(() => {
    const c = inkRef.current;
    if (!near || !c) return;
    drawStrokes(prepareCanvas(c, width, height, inkScale), visibleInk(page, showNotes));
    drawLiveNow();
  }, [near, page, showNotes, width, height, inkScale, drawLiveNow]);

  useLayoutEffect(() => {
    if (near) drawLiveNow();
  }, [near, selection, tool, drawLiveNow]);

  const pageW = page.width * zoom;
  const cssW = width * zoom;
  const cssH = height * zoom;

  return (
    <div
      ref={containerRef}
      className="page-row"
      data-index={index}
      data-page-id={page.id}
      style={{ width: cssW, height: cssH, cursor: tool === "eraser" ? "none" : tool === "lasso" ? "default" : "crosshair" }}
      {...input.handlers}
    >
      <div className="page" style={{ width: pageW, height: cssH }}>
        {near && page.source && <canvas ref={bgRef} className="layer" style={{ width: pageW, height: page.baseHeight * zoom }} />}
        {near && page.extraHeight > 0 && page.source && (
          <div className="page-seam" style={{ top: page.baseHeight * zoom }} />
        )}
      </div>
      {showNotes && (
        <div
          className="notes-margin"
          style={{ left: (page.width + NOTES_GAP) * zoom, width: NOTES_WIDTH * zoom, height: cssH }}
        >
          {index === 0 && <span className="notes-label">Notes · not exported</span>}
        </div>
      )}
      {near && (
        <>
          <canvas ref={inkRef} className="layer ink" style={{ width: cssW, height: cssH }} />
          <canvas ref={liveRef} className="layer ink" style={{ width: cssW, height: cssH }} />
        </>
      )}
      <div className="page-number">{index + 1}</div>
    </div>
  );
});
