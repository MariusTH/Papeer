import { ReactNode } from "react";
import { addPageAfterCurrent, exportToPdf, newDocument, openFile, saveProject, zoomBy } from "../actions";
import { effectiveTool, HIGHLIGHTER_COLORS, PEN_COLORS, SIZES, useStore } from "../model/store";
import { Tool } from "../model/types";
import { lastSaveError } from "../io/autosave";
import { isTauri } from "../platform";
import { BrushPicker } from "./BrushPicker";
import { THEME_CHOICES, ThemeChoice } from "./theme";

const icon = (d: string) => (
  <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
    <path d={d} />
  </svg>
);

const ICONS: Record<Tool, ReactNode> = {
  pen: icon("M4 20l4-1 11-11-3-3L5 16l-1 4zM14 6l3 3"),
  highlighter: icon("M9 15l-4 5h6l2-2M9 15l7-11 4 3-7 11-4-3z"),
  eraser: icon("M7 20h10M4 15l8-8 6 6-5 5H8l-4-3z"),
  lasso: icon("M12 4c5 0 9 2.5 9 5.5S17 15 12 15s-9-2.5-9-5.5S7 4 12 4zM6 14c-1 2 0 4 2 5"),
};
const LABELS: Record<Tool, string> = { pen: "Pen (P)", highlighter: "Highlighter (H)", eraser: "Eraser (E)", lasso: "Lasso select (L)" };

function Btn(props: { title: string; onClick: () => void; active?: boolean; disabled?: boolean; children: ReactNode }) {
  return (
    <button className={`btn${props.active ? " active" : ""}`} title={props.title} onClick={props.onClick} disabled={props.disabled}>
      {props.children}
    </button>
  );
}

export function Toolbar({ theme, onTheme }: { theme: ThemeChoice; onTheme: (t: ThemeChoice) => void }) {
  const tool = useStore(effectiveTool);
  const device = useStore((s) => s.device);
  const saveState = useStore((s) => s.saveState);
  const dirty = useStore((s) => s.dirty);
  const filePath = useStore((s) => s.filePath);
  const colors = useStore((s) => s.colors);
  const sizeIndex = useStore((s) => s.sizeIndex);
  const canUndo = useStore((s) => s.history.past.length > 0);
  const canRedo = useStore((s) => s.history.future.length > 0);
  const zoom = useStore((s) => s.zoom);
  const currentPage = useStore((s) => s.currentPage);
  const pageCount = useStore((s) => s.pages.length);
  const showThumbs = useStore((s) => s.showThumbs);
  const showNotes = useStore((s) => s.showNotes);
  const s = useStore.getState();

  const inkTool = tool === "pen" || tool === "highlighter" ? tool : null;
  const palette = inkTool === "highlighter" ? HIGHLIGHTER_COLORS : PEN_COLORS;

  return (
    <div className="toolbar">
      <div className="group">
        <Btn title="New (⌘N)" onClick={newDocument}>New</Btn>
        <Btn title="Open PDF or project (⌘O)" onClick={openFile}>Open</Btn>
        <Btn title={isTauri ? "Save a copy as… (⇧⌘S)" : "Download the project file (⇧⌘S)"} onClick={() => saveProject(true)}>
          {isTauri ? "Save As" : "Download"}
        </Btn>
        <Btn title="Export PDF (⌘E)" onClick={exportToPdf}>Export PDF</Btn>
      </div>

      <div className="group">
        {(Object.keys(ICONS) as Tool[]).map((t) => (
          <Btn key={t} title={LABELS[t]} active={tool === t} onClick={() => s.setTool(t)}>
            {ICONS[t]}
          </Btn>
        ))}
      </div>

      {tool === "pen" && <BrushPicker />}

      {inkTool && (
        <div className="group">
          {palette.map((c) => (
            <button
              key={c}
              className={`swatch${colors[inkTool] === c ? " active" : ""}`}
              style={{ background: c }}
              title={c}
              onClick={() => s.setColor(inkTool, c)}
            />
          ))}
        </div>
      )}

      {tool !== "lasso" && (
        <div className="group">
          {SIZES[tool].map((size, i) => (
            <button
              key={size}
              className={`btn size${sizeIndex[tool] === i ? " active" : ""}`}
              title={`Size ${i + 1}`}
              onClick={() => s.setSizeIndex(tool, i)}
            >
              <span className="dot" style={{ width: 4 + i * 5, height: 4 + i * 5 }} />
            </button>
          ))}
        </div>
      )}

      <div className="group">
        <Btn title="Undo (⌘Z)" onClick={s.undo} disabled={!canUndo}>{icon("M9 14L4 9l5-5M4 9h11a5 5 0 010 10h-3")}</Btn>
        <Btn title="Redo (⇧⌘Z)" onClick={s.redo} disabled={!canRedo}>{icon("M15 14l5-5-5-5M20 9H9a5 5 0 000 10h3")}</Btn>
      </div>

      <div className="spacer" />

      <div className="group">
        <span
          className={`save-status ${saveState}`}
          title={
            saveState === "error"
              ? lastSaveError()
              : !filePath
                ? "Autosaves after your first edit"
                : isTauri
                  ? `Autosaved to ${filePath}`
                  : "Autosaved in this browser (localStorage). Use Download to keep a copy."
          }
        >
          {saveState === "error" ? "Save failed" : saveState === "saving" || dirty ? "Saving…" : filePath ? "Saved" : "Not edited"}
        </span>
      </div>

      <div className="group">
        <span className={`device ${device}`} title="Input device (from the tablet driver)">
          {device === "eraser" ? "Eraser end" : device === "pen" ? "Pen" : "Mouse"}
        </span>
      </div>

      <div className="group">
        <Btn title="Page thumbnails (⌥⌘T)" active={showThumbs} onClick={s.toggleThumbs}>
          {icon("M4 4h6v7H4zM4 15h6v5H4zM14 4h6v16h-6")}
        </Btn>
        <Btn title="Notes margin — your own notes beside each page, never exported (⌥⌘M)" active={showNotes} onClick={s.toggleNotes}>
          {icon("M4 4h10v16H4zM17 6h3M17 10h3M17 14h3")}
        </Btn>
      </div>

      <div className="group">
        <Btn title="Insert blank page after current" onClick={addPageAfterCurrent}>+ Page</Btn>
        <span className="label">{currentPage + 1} / {pageCount}</span>
      </div>
      <div className="group">
        <select className="theme-select" title="Display theme (screen only; exports are unaffected)" value={theme} onChange={(e) => onTheme(e.target.value as ThemeChoice)}>
          {THEME_CHOICES.map((c) => (
            <option key={c.value} value={c.value}>{c.label}</option>
          ))}
        </select>
      </div>
      <div className="group">
        <Btn title="Zoom out (⌘-)" onClick={() => zoomBy(1 / 1.2)}>−</Btn>
        <button className="btn label" title="Fit width (⌘0)" onClick={s.requestFit}>{Math.round(zoom * 100)}%</button>
        <Btn title="Zoom in (⌘+)" onClick={() => zoomBy(1.2)}>+</Btn>
      </div>
    </div>
  );
}
