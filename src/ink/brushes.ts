import { BrushId, Stroke } from "../model/types";

export interface BrushStyle {
  label: string;
  hint: string;
  /** How much pressure changes the width (0 = constant width, 1 = maximum). */
  thinning: number;
  /** Multiplier on the chosen size. */
  sizeScale: number;
  /** Tapered start/end length, in multiples of the stroke size (0 = round cap). */
  taper: number;
  opacity: number;
}

export const BRUSHES: Record<BrushId, BrushStyle> = {
  fineliner: { label: "Fineliner", hint: "Even width — clearest for small handwriting", thinning: 0, sizeScale: 0.75, taper: 0, opacity: 1 },
  ballpoint: { label: "Ballpoint", hint: "Slight pressure response", thinning: 0.35, sizeScale: 0.9, taper: 0, opacity: 1 },
  fountain: { label: "Fountain pen", hint: "Thin when light, bold when pressed", thinning: 0.8, sizeScale: 1.25, taper: 0, opacity: 1 },
  brush: { label: "Brush", hint: "Strong pressure response with tapered ends", thinning: 0.95, sizeScale: 2.4, taper: 4, opacity: 1 },
  pencil: { label: "Pencil", hint: "Light, slightly transparent", thinning: 0.5, sizeScale: 0.8, taper: 0, opacity: 0.72 },
};

export const BRUSH_IDS = Object.keys(BRUSHES) as BrushId[];
export const DEFAULT_BRUSH: BrushId = "ballpoint";

export const HIGHLIGHTER_OPACITY = 0.35;

/** Look of pen strokes saved before brushes existed. */
const LEGACY: BrushStyle = { label: "Pen", hint: "", thinning: 0.6, sizeScale: 1, taper: 0, opacity: 1 };
const HIGHLIGHTER: BrushStyle = { label: "Highlighter", hint: "", thinning: 0, sizeScale: 1, taper: 0, opacity: HIGHLIGHTER_OPACITY };

export function styleOf(s: Pick<Stroke, "tool" | "brush">): BrushStyle {
  if (s.tool === "highlighter") return HIGHLIGHTER;
  return s.brush ? BRUSHES[s.brush] : LEGACY;
}

export type PressureContrast = "low" | "medium" | "high";
export const PRESSURE_CONTRASTS: { value: PressureContrast; label: string }[] = [
  { value: "low", label: "Low" },
  { value: "medium", label: "Medium" },
  { value: "high", label: "High" },
];
/**
 * Raw pressure range mapped onto thinnest → thickest. Most hands write between ~0.25 and
 * ~0.65, so narrower ranges make light vs. firm strokes look more different.
 */
const RANGE: Record<PressureContrast, [number, number]> = {
  low: [0, 1],
  medium: [0.12, 0.82],
  high: [0.22, 0.7],
};

export interface PressureSettings {
  contrast: PressureContrast;
  /**
   * Length of the "thin start" (0–0.8): over this first part of the range the line stays
   * near its thinnest and eases in, then grows linearly.
   */
  thinStart: number;
}

export const MIN_PRESSURE = 0.02;

/** Maps raw tablet pressure (0–1) to the pressure a brush sees (0.02–1). */
export function pressureCurve(p: number, { contrast, thinStart }: PressureSettings): number {
  const [lo, hi] = RANGE[contrast];
  const x = Math.min(1, Math.max(0, (p - lo) / (hi - lo)));
  // Quadratic toe of length k joined smoothly to a straight line, normalised to end at 1.
  const k = Math.min(0.8, Math.max(0, thinStart));
  const f = (t: number) => (k > 0 && t < k ? (t * t) / (2 * k) : t - k / 2);
  return MIN_PRESSURE + (1 - MIN_PRESSURE) * (f(x) / f(1));
}
