import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { clampZoom, useStore } from "../model/store";
import { NOTES_GAP, NOTES_WIDTH } from "../model/types";
import { PageView, ScrollRootContext } from "./PageView";

const PADDING = 24;
/** Fit never zooms in further than this. */
const MAX_FIT_ZOOM = 3;
/** Room right of each page for the page number. */
const NUMBER_ROOM = 40;

export function DocumentView() {
  const pages = useStore((s) => s.pages);
  const zoom = useStore((s) => s.zoom);
  const fitRequest = useStore((s) => s.fitRequest);
  const docVersion = useStore((s) => s.docVersion);
  const showNotes = useStore((s) => s.showNotes);
  const [root, setRoot] = useState<HTMLDivElement | null>(null);
  const anchor = useRef<{ px: number; py: number; cx: number; cy: number; zoom: number } | null>(null);

  // A newly shown document (load or tab switch) starts where it was left.
  useLayoutEffect(() => {
    if (root) root.scrollTop = useStore.getState().restoreScroll;
  }, [root, docVersion]);

  // Fit page width (plus notes margin) to the window, keeping the reading position.
  const fit = useCallback(() => {
    if (!root) return;
    const s = useStore.getState();
    const margin = s.showNotes ? NOTES_GAP + NOTES_WIDTH : 0;
    const maxW = Math.max(...s.pages.map((p) => p.width + margin));
    const z = clampZoom(Math.min((root.clientWidth - PADDING * 2 - NUMBER_ROOM) / maxW, MAX_FIT_ZOOM));
    if (Math.abs(z - s.zoom) < 0.001) return s.setFitZoom(s.zoom);
    anchor.current = { px: root.scrollLeft, py: root.scrollTop, cx: 0, cy: 0, zoom: s.zoom };
    s.setFitZoom(z);
  }, [root]);

  useLayoutEffect(fit, [fit, fitRequest]);

  // While in fit mode, follow window resizes (and the thumbnail sidebar opening/closing).
  useEffect(() => {
    if (!root) return;
    let raf = 0;
    const ro = new ResizeObserver(() => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        if (useStore.getState().fitMode) fit();
      });
    });
    ro.observe(root);
    return () => {
      ro.disconnect();
      cancelAnimationFrame(raf);
    };
  }, [root, fit]);

  // Pinch / Cmd+wheel zoom around the cursor.
  useEffect(() => {
    if (!root) return;
    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      const s = useStore.getState();
      const factor = Math.exp(-e.deltaY * (e.ctrlKey && !e.metaKey ? 0.01 : 0.002));
      const rect = root.getBoundingClientRect();
      const cx = e.clientX - rect.left;
      const cy = e.clientY - rect.top;
      anchor.current = { px: root.scrollLeft + cx, py: root.scrollTop + cy, cx, cy, zoom: s.zoom };
      s.setZoom(s.zoom * factor);
    };
    root.addEventListener("wheel", onWheel, { passive: false });
    return () => root.removeEventListener("wheel", onWheel);
  }, [root]);

  useLayoutEffect(() => {
    const a = anchor.current;
    if (!root || !a) return;
    anchor.current = null;
    const k = zoom / a.zoom;
    root.scrollLeft = a.px * k - a.cx;
    root.scrollTop = a.py * k - a.cy;
  }, [zoom, root]);

  // Track which page is at the middle of the viewport.
  useEffect(() => {
    if (!root) return;
    let raf = 0;
    const update = () => {
      raf = 0;
      const mid = root.getBoundingClientRect().top + root.clientHeight / 2;
      const els = root.querySelectorAll<HTMLElement>(".page-row");
      let best = 0;
      for (const el of els) {
        const r = el.getBoundingClientRect();
        if (r.top <= mid) best = Number(el.dataset.index);
        else break;
      }
      if (useStore.getState().currentPage !== best) useStore.getState().setCurrentPage(best);
    };
    const onScroll = () => {
      if (!raf) raf = requestAnimationFrame(update);
    };
    root.addEventListener("scroll", onScroll, { passive: true });
    update();
    return () => {
      root.removeEventListener("scroll", onScroll);
      cancelAnimationFrame(raf);
    };
  }, [root, pages.length, showNotes]);

  return (
    <div className="document" ref={setRoot}>
      <ScrollRootContext.Provider value={root}>
        <div className="pages">
          {pages.map((p, i) => (
            <PageView key={p.id} page={p} index={i} />
          ))}
        </div>
      </ScrollRootContext.Provider>
    </div>
  );
}
