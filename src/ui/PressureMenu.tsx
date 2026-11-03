import { useEffect, useRef, useState } from "react";
import { PRESSURE_CONTRASTS, pressureCurve, PressureSettings } from "../ink/brushes";
import { useStore } from "../model/store";

const W = 160;
const H = 100;

/** Raw pressure (x) → line weight (y), as an SVG polyline. */
function curvePath(settings: PressureSettings, w: number, h: number) {
  const pts: string[] = [];
  for (let i = 0; i <= 60; i++) {
    const x = i / 60;
    pts.push(`${(x * w).toFixed(1)},${(h - pressureCurve(x, settings) * h).toFixed(1)}`);
  }
  return pts.join(" ");
}

/** Toolbar button + popover for shaping pen pressure (contrast and thin start). */
export function PressureMenu() {
  const pressure = useStore((s) => s.pressure);
  const setPressure = useStore((s) => s.setPressure);
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const close = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    window.addEventListener("pointerdown", close);
    return () => window.removeEventListener("pointerdown", close);
  }, [open]);

  return (
    <div className="popover-anchor" ref={ref}>
      <button className={`btn${open ? " active" : ""}`} title="Pen pressure curve" onClick={() => setOpen(!open)}>
        <svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round">
          <path d="M4 20h16M4 20V4" opacity="0.45" />
          <polyline points={curvePath(pressure, 16, 16).split(" ").map((p) => p.split(",").map((n, i) => Number(n) + (i ? 3 : 4)).join(",")).join(" ")} />
        </svg>
      </button>
      {open && (
        <div className="popover pressure-menu">
          <div className="popover-title">Pen pressure</div>
          <svg className="curve" viewBox={`-2 -2 ${W + 4} ${H + 4}`} width={W + 4} height={H + 4}>
            <rect x="0" y="0" width={W} height={H} className="curve-bg" />
            <line x1="0" y1={H} x2={W} y2="0" className="curve-diag" />
            <polyline points={curvePath(pressure, W, H)} className="curve-line" />
          </svg>
          <div className="curve-axes">
            <span>light</span>
            <span>firm →</span>
          </div>

          <label className="field">
            <span>Thin start</span>
            <input
              type="range"
              min={0}
              max={0.8}
              step={0.05}
              value={pressure.thinStart}
              onChange={(e) => setPressure({ thinStart: Number(e.target.value) })}
            />
          </label>
          <p className="field-hint">How long the line stays thin before it starts to thicken.</p>

          <div className="field">
            <span>Contrast</span>
            <div className="segmented">
              {PRESSURE_CONTRASTS.map((c) => (
                <button
                  key={c.value}
                  className={pressure.contrast === c.value ? "active" : ""}
                  onClick={() => setPressure({ contrast: c.value })}
                >
                  {c.label}
                </button>
              ))}
            </div>
          </div>
          <p className="field-hint">Applies to new strokes.</p>
        </div>
      )}
    </div>
  );
}
