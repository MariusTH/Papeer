import { BlendMode, degrees, PDFDocument, PDFPage, rgb } from "pdf-lib";
import { styleOf } from "../ink/brushes";
import { strokeSvgPath } from "../ink/outline";
import { trimExtension } from "../model/ops";
import { Page, pageHeight } from "../model/types";

export function hexToRgb(hex: string) {
  const m = /^#?([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(hex);
  if (!m) return rgb(0, 0, 0);
  return rgb(parseInt(m[1], 16) / 255, parseInt(m[2], 16) / 255, parseInt(m[3], 16) / 255);
}

export interface ExportOptions {
  /** Remove unused extension space below the last stroke. */
  trim?: boolean;
}

/** Builds a flattened PDF: original pages as vector content + strokes as vector paths. */
export async function exportPdf(
  pages: Page[],
  pdfBytes: Uint8Array | null,
  opts: ExportOptions = { trim: true },
): Promise<Uint8Array> {
  const out = await PDFDocument.create();
  const src = pdfBytes ? await PDFDocument.load(pdfBytes, { ignoreEncryption: true }) : null;

  for (const original of pages) {
    const page = opts.trim ? trimExtension(original) : original;
    const height = pageHeight(page);
    const target = out.addPage([page.width, height]);

    if (page.source && src) {
      await drawSourcePage(out, target, src.getPage(page.source.pdfPageIndex), page.extraHeight);
    }

    for (const s of page.strokes) {
      const path = strokeSvgPath(s);
      if (!path) continue;
      const hl = s.tool === "highlighter";
      target.drawSvgPath(path, {
        x: 0,
        y: height,
        color: hexToRgb(s.color),
        opacity: styleOf(s).opacity,
        blendMode: hl ? BlendMode.Multiply : BlendMode.Normal,
      });
    }
  }
  return out.save();
}

/** Places the original page at the top of `target`, honoring its /Rotate. */
async function drawSourcePage(out: PDFDocument, target: PDFPage, srcPage: PDFPage, extra: number) {
  // Pages without a content stream are blank; pdf-lib cannot embed them.
  if (!srcPage.node.Contents()) return;
  const box = srcPage.getCropBox();
  const embedded = await out.embedPage(srcPage, {
    left: box.x,
    bottom: box.y,
    right: box.x + box.width,
    top: box.y + box.height,
  });
  const w = embedded.width;
  const h = embedded.height;
  const rot = ((srcPage.getRotation().angle % 360) + 360) % 360;
  // pdf-lib rotates counter-clockwise around (x, y); /Rotate is clockwise.
  const place =
    rot === 90
      ? { x: 0, y: extra + w, rotate: degrees(-90) }
      : rot === 180
        ? { x: w, y: extra + h, rotate: degrees(180) }
        : rot === 270
          ? { x: h, y: extra, rotate: degrees(90) }
          : { x: 0, y: extra, rotate: degrees(0) };
  target.drawPage(embedded, { ...place, width: w, height: h });
}
