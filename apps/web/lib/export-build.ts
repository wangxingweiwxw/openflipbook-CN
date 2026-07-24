// Session-path exports — pure builders over already-fetched page bytes, so
// every format is unit-testable without storage. The route walks the chain
// (db.getNodeChain), fetches each page's stored JPEG (r2.getStoredBytes) and
// hands the list here. Pure-JS deps only (jszip / pdf-lib / gifenc + jpeg-js
// + pngjs) — no native modules, Vercel-safe.

import JSZip from "jszip";
import { PDFDocument, StandardFonts, rgb, type PDFImage } from "pdf-lib";

export interface ExportPage {
  id: string;
  parent_id: string | null;
  title: string;
  query: string;
  created_at: string;
  bytes: Uint8Array;
  /** R2 Content-Type when known — export also sniffs magic bytes. */
  contentType?: string | null;
}

export type ImageKind = "jpeg" | "png" | "unknown";

/** Sniff stored bytes (and optional Content-Type) — OpenRouter image slugs
 * often land as PNG even though the field is named jpeg_bytes upstream. */
export function detectImageKind(
  bytes: Uint8Array,
  contentType?: string | null,
): ImageKind {
  if (
    bytes.length >= 3 &&
    bytes[0] === 0xff &&
    bytes[1] === 0xd8 &&
    bytes[2] === 0xff
  ) {
    return "jpeg";
  }
  if (
    bytes.length >= 8 &&
    bytes[0] === 0x89 &&
    bytes[1] === 0x50 &&
    bytes[2] === 0x4e &&
    bytes[3] === 0x47
  ) {
    return "png";
  }
  const ct = (contentType ?? "").toLowerCase();
  if (ct.includes("png")) return "png";
  if (ct.includes("jpeg") || ct.includes("jpg")) return "jpeg";
  return "unknown";
}

function fileExt(kind: ImageKind): string {
  return kind === "png" ? "png" : "jpg";
}

async function embedInPdf(
  doc: PDFDocument,
  bytes: Uint8Array,
  contentType?: string | null,
): Promise<PDFImage> {
  const kind = detectImageKind(bytes, contentType);
  if (kind === "png") return doc.embedPng(bytes);
  if (kind === "jpeg") return doc.embedJpg(bytes);
  throw new Error(
    `unsupported image format for PDF export (${contentType ?? "unknown"})`,
  );
}

export interface RgbaFrame {
  width: number;
  height: number;
  data: Uint8ClampedArray | Uint8Array;
}

/** Decode a stored page image to RGBA for GIF encoding. */
export async function decodeImageToRgba(
  bytes: Uint8Array,
  contentType?: string | null,
): Promise<RgbaFrame> {
  const kind = detectImageKind(bytes, contentType);
  if (kind === "jpeg") {
    const { decode } = await import("jpeg-js");
    const d = decode(Buffer.from(bytes), {
      useTArray: true,
      maxMemoryUsageInMB: 1024,
    });
    return { width: d.width, height: d.height, data: d.data };
  }
  if (kind === "png") {
    const { PNG } = await import("pngjs");
    const parsed = PNG.sync.read(Buffer.from(bytes));
    return {
      width: parsed.width,
      height: parsed.height,
      data: new Uint8Array(parsed.data),
    };
  }
  throw new Error(
    `unsupported image format for GIF export (${contentType ?? "unknown"})`,
  );
}

/** Letterbox (or scale-down) a frame onto a shared canvas — gifenc requires
 * every frame share the same dimensions. */
export function letterboxFrame(
  frame: RgbaFrame,
  canvasW: number,
  canvasH: number,
  bg: readonly [number, number, number, number] = [240, 235, 222, 255],
): RgbaFrame {
  if (frame.width === canvasW && frame.height === canvasH) return frame;
  const out = new Uint8Array(canvasW * canvasH * 4);
  for (let i = 0; i < out.length; i += 4) {
    out[i] = bg[0]!;
    out[i + 1] = bg[1]!;
    out[i + 2] = bg[2]!;
    out[i + 3] = bg[3]!;
  }
  const scale = Math.min(
    1,
    canvasW / frame.width,
    canvasH / frame.height,
  );
  const dw = Math.max(1, Math.round(frame.width * scale));
  const dh = Math.max(1, Math.round(frame.height * scale));
  const ox = Math.floor((canvasW - dw) / 2);
  const oy = Math.floor((canvasH - dh) / 2);
  const src = frame.data;
  for (let y = 0; y < dh; y++) {
    const sy = Math.min(frame.height - 1, Math.floor((y / dh) * frame.height));
    for (let x = 0; x < dw; x++) {
      const sx = Math.min(frame.width - 1, Math.floor((x / dw) * frame.width));
      const si = (sy * frame.width + sx) * 4;
      const di = ((oy + y) * canvasW + (ox + x)) * 4;
      out[di] = src[si]!;
      out[di + 1] = src[si + 1]!;
      out[di + 2] = src[si + 2]!;
      out[di + 3] = src[si + 3]!;
    }
  }
  return { width: canvasW, height: canvasH, data: out };
}

export function normalizeGifFrames(frames: RgbaFrame[]): RgbaFrame[] {
  if (frames.length === 0) return frames;
  const canvasW = Math.max(...frames.map((f) => f.width));
  const canvasH = Math.max(...frames.map((f) => f.height));
  return frames.map((f) => letterboxFrame(f, canvasW, canvasH));
}

/** Evenly sample at most `cap` indices from 0..n-1, always keeping the first
 * and last (a GIF of a 40-page path should still open on the root and end on
 * the exported page). */
export function sampleEvenly(n: number, cap: number): number[] {
  if (n <= 0) return [];
  if (n <= cap) return Array.from({ length: n }, (_, i) => i);
  const out: number[] = [];
  for (let i = 0; i < cap; i++) {
    out.push(Math.round((i * (n - 1)) / (cap - 1)));
  }
  return [...new Set(out)];
}

/** ZIP: NN-title.jpg per page + graph.json (ids/titles/parents — enough to
 * rebuild the path structure elsewhere). */
export async function buildZip(pages: ExportPage[]): Promise<Uint8Array> {
  const zip = new JSZip();
  pages.forEach((p, i) => {
    const slug = p.title.replace(/[^\w\- ]+/g, "").trim().slice(0, 60) || p.id;
    const ext = fileExt(detectImageKind(p.bytes, p.contentType));
    zip.file(
      `pages/${String(i + 1).padStart(2, "0")}-${slug}.${ext}`,
      p.bytes,
    );
  });
  zip.file(
    "graph.json",
    JSON.stringify(
      {
        exported_path: pages.map((p) => ({
          id: p.id,
          parent_id: p.parent_id,
          title: p.title,
          query: p.query,
          created_at: p.created_at,
        })),
      },
      null,
      2,
    ),
  );
  return zip.generateAsync({ type: "uint8array" });
}

/**
 * Helvetica (StandardFonts) is WinAnsi-only — CJK / emoji / most Unicode
 * throws `WinAnsi cannot encode "…"`. Keep ASCII + Latin-1 printable; drop
 * the rest. Empty result → caller uses a safe fallback (the illustration
 * already carries the real title as pixels).
 */
export function toWinAnsiLabel(text: string): string {
  let out = "";
  for (const ch of text) {
    const code = ch.codePointAt(0) ?? 0;
    // ASCII printable + NBSP..ÿ (covers WinAnsi / Latin-1 that Helvetica maps)
    if ((code >= 0x20 && code <= 0x7e) || (code >= 0xa0 && code <= 0xff)) {
      out += ch;
    }
  }
  return out.replace(/\s+/g, " ").trim().slice(0, 140);
}

/** Flipbook PDF: one full-bleed page per image with a slim title strip under
 * it — the artifact the project is named after. */
export async function buildFlipbookPdf(pages: ExportPage[]): Promise<Uint8Array> {
  const doc = await PDFDocument.create();
  doc.setTitle("openflipbook export");
  const font = await doc.embedFont(StandardFonts.Helvetica);
  const STRIP = 26;
  for (let i = 0; i < pages.length; i++) {
    const p = pages[i]!;
    const img = await embedInPdf(doc, p.bytes, p.contentType);
    const page = doc.addPage([img.width, img.height + STRIP]);
    page.drawImage(img, { x: 0, y: STRIP, width: img.width, height: img.height });
    page.drawRectangle({
      x: 0,
      y: 0,
      width: img.width,
      height: STRIP,
      color: rgb(0.94, 0.92, 0.87),
    });
    const label = toWinAnsiLabel(p.title) || `Page ${i + 1}`;
    page.drawText(label, {
      x: 12,
      y: 8,
      size: 12,
      font,
      color: rgb(0.24, 0.2, 0.16),
    });
  }
  return doc.save();
}

/** Animated GIF from decoded RGBA frames (the route decodes JPEG/PNG and
 * pre-samples via sampleEvenly). ~900ms per page. */
export async function buildGif(frames: RgbaFrame[]): Promise<Uint8Array> {
  const normalized = normalizeGifFrames(frames);
  const { GIFEncoder, quantize, applyPalette } = await import("gifenc");
  const gif = GIFEncoder();
  for (const f of normalized) {
    const rgba = new Uint8Array(
      f.data.buffer,
      f.data.byteOffset,
      f.data.byteLength,
    );
    const palette = quantize(rgba, 256);
    const indexed = applyPalette(rgba, palette);
    gif.writeFrame(indexed, f.width, f.height, { palette, delay: 900 });
  }
  gif.finish();
  return gif.bytes();
}
