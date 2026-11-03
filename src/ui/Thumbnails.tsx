import type { RenderTask } from "pdfjs-dist";
import { memo, useEffect, useRef, useState } from "react";
import { drawStrokes, prepareCanvas } from "../canvas/render";
import { useStore } from "../model/store";
import { Page, pageHeight } from "../model/types";

/** Thumbnail width in CSS pixels. */
const THUMB_W = 132;
/** Very long pages are shown cropped to this many widths tall. */
const MAX_ASPECT = 2.2;

/** Scrolls the document so the given page's top is in view. */
export function scrollToPage(index: number) {
  const el = document.querySelector<HTMLElement>(`.page-row[data-index="${index}"]`);
  const root = el?.closest<HTMLElement>(".document");
  if (!el || !root) return;
  const top = el.getBoundingClientRect().top - root.getBoundingClientRect().top + root.scrollTop;
  root.scrollTo({ top: top - 16, behavior: "smooth" });
}

const Thumb = memo(function Thumb({
  page,
  index,
  current,
  root,
}: {
  page: Page;
  index: number;
  current: boolean;
  root: HTMLElement | null;
}) {
  const pdf = useStore((s) => s.pdf);
  const ref = useRef<HTMLButtonElement>(null);
  const bgRef = useRef<HTMLCanvasElement>(null);
  const inkRef = useRef<HTMLCanvasElement>(null);
  const [near, setNear] = useState(false);

  const scale = THUMB_W / page.width; // CSS px per point
  const fullH = pageHeight(page) * scale;
  const shownH = Math.min(fullH, THUMB_W * MAX_ASPECT);
  const dpr = window.devicePixelRatio || 1;

  useEffect(() => {
    const el = ref.current;
    if (!el || !root) return;
    const io = new IntersectionObserver(([e]) => setNear(e.isIntersecting), { root, rootMargin: "600px 0px" });
    io.observe(el);
    return () => io.disconnect();
  }, [root]);

  // Free bitmaps when scrolled far away.
  useEffect(() => {
    if (!near) return;
    const cs = [bgRef.current, inkRef.current];
    return () => {
      for (const c of cs) if (c) c.width = c.height = 0;
    };
  }, [near]);

  // Keep the current page's thumbnail in view.
  useEffect(() => {
    if (current) ref.current?.scrollIntoView({ block: "nearest" });
  }, [current]);

  // PDF background, rendered once per page at thumbnail resolution.
  useEffect(() => {
    const c = bgRef.current;
    if (!near || !c || !pdf || !page.source) return;
    let task: RenderTask | null = null;
    let cancelled = false;
    pdf.getPage(page.source.pdfPageIndex + 1).then((p) => {
      if (cancelled) return;
      const viewport = p.getViewport({ scale: scale * dpr });
      c.width = Math.round(viewport.width);
      c.height = Math.round(viewport.height);
      task = p.render({ canvas: c, canvasContext: c.getContext("2d")!, viewport });
      task.promise.catch(() => {});
    });
    return () => {
      cancelled = true;
      task?.cancel();
    };
  }, [near, pdf, page.source, scale, dpr]);

  // Page ink (not margin notes), redrawn shortly after edits.
  useEffect(() => {
    const c = inkRef.current;
    if (!near || !c) return;
    const t = setTimeout(() => {
      drawStrokes(prepareCanvas(c, page.width, pageHeight(page), scale * dpr), page.strokes);
    }, 250);
    return () => clearTimeout(t);
  }, [near, page, scale, dpr]);

  return (
    <button
      ref={ref}
      className={`thumb${current ? " current" : ""}`}
      title={`Page ${index + 1}`}
      onClick={() => scrollToPage(index)}
    >
      <div className="thumb-paper" style={{ width: THUMB_W, height: shownH }}>
        {near && (
          <>
            {page.source && (
              <canvas ref={bgRef} className="layer" style={{ width: THUMB_W, height: page.baseHeight * scale }} />
            )}
            <canvas ref={inkRef} className="layer ink" style={{ width: THUMB_W, height: fullH }} />
          </>
        )}
        {fullH > shownH && <div className="thumb-more" />}
      </div>
      <span className="thumb-number">
        {index + 1}
        {page.notes?.length ? <span className="thumb-notes" title="Has margin notes" /> : null}
      </span>
    </button>
  );
});

export function Thumbnails() {
  const pages = useStore((s) => s.pages);
  const currentPage = useStore((s) => s.currentPage);
  const [root, setRoot] = useState<HTMLElement | null>(null);

  return (
    <nav className="thumbnails" ref={setRoot} aria-label="Pages">
      {pages.map((p, i) => (
        <Thumb key={p.id} page={p} index={i} current={i === currentPage} root={root} />
      ))}
    </nav>
  );
}
