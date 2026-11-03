import { BRUSH_IDS, BRUSHES } from "../ink/brushes";
import { strokeSvgPath } from "../ink/outline";
import { useStore } from "../model/store";
import { BrushId, Stroke } from "../model/types";
import { PressureMenu } from "./PressureMenu";

/** A short wave drawn light → heavy → light, so each preview shows how the pen reacts to pressure. */
const SAMPLE = Array.from({ length: 40 }, (_, i) => {
  const t = i / 39;
  return { x: 3 + t * 30, y: 10 + Math.sin(t * Math.PI * 2.2) * 5, p: 0.1 + 0.85 * Math.sin(t * Math.PI) };
});

const previews = Object.fromEntries(
  BRUSH_IDS.map((b) => {
    const s: Stroke = { id: b, tool: "pen", brush: b, color: "#000", size: 1.6, points: SAMPLE };
    return [b, strokeSvgPath(s)];
  }),
) as Record<BrushId, string>;

export function BrushPicker() {
  const brush = useStore((s) => s.brush);
  const { setBrush } = useStore.getState();

  return (
    <div className="group">
      {BRUSH_IDS.map((b) => (
        <button
          key={b}
          className={`btn brush${brush === b ? " active" : ""}`}
          title={`${BRUSHES[b].label} — ${BRUSHES[b].hint}`}
          onClick={() => setBrush(b)}
        >
          <svg viewBox="0 0 36 20" width="36" height="20" aria-label={BRUSHES[b].label}>
            <path d={previews[b]} fill="currentColor" opacity={BRUSHES[b].opacity} />
          </svg>
        </button>
      ))}
      <PressureMenu />
    </div>
  );
}
