import JSZip from "jszip";
import { PDFDocument } from "pdf-lib";
import { PNG } from "pngjs";
import { describe, expect, it } from "vitest";

import {
  buildFlipbookPdf,
  buildGif,
  buildZip,
  decodeImageToRgba,
  detectImageKind,
  normalizeGifFrames,
  sampleEvenly,
  toWinAnsiLabel,
  type ExportPage,
} from "./export-build";

// A minimal valid JPEG (1x1, generated once with jpeg-js) — enough for the
// zip entries; the PDF test needs real JPEG structure, which this is.
async function tinyJpeg(): Promise<Uint8Array> {
  const { encode } = await import("jpeg-js");
  const data = new Uint8Array([200, 180, 150, 255]);
  return new Uint8Array(
    encode({ data, width: 1, height: 1 }, 90).data,
  );
}

function tinyPng(): Uint8Array {
  const png = new PNG({ width: 2, height: 2 });
  png.data.fill(128);
  return new Uint8Array(PNG.sync.write(png));
}

function page(
  id: string,
  bytes: Uint8Array,
  parent: string | null,
  contentType?: string,
): ExportPage {
  return {
    id,
    parent_id: parent,
    title: `Page ${id}`,
    query: `query ${id}`,
    created_at: "2026-06-11T00:00:00Z",
    bytes,
    contentType,
  };
}

describe("detectImageKind", () => {
  it("sniffs JPEG and PNG magic bytes", async () => {
    const jpg = await tinyJpeg();
    const png = tinyPng();
    expect(detectImageKind(jpg)).toBe("jpeg");
    expect(detectImageKind(png)).toBe("png");
    expect(detectImageKind(jpg, "image/png")).toBe("jpeg");
    expect(detectImageKind(new Uint8Array([0, 1, 2]), "image/png")).toBe("png");
  });
});

describe("sampleEvenly", () => {
  it("identity under the cap; first+last kept over it", () => {
    expect(sampleEvenly(3, 16)).toEqual([0, 1, 2]);
    const sampled = sampleEvenly(40, 16);
    expect(sampled.length).toBeLessThanOrEqual(16);
    expect(sampled[0]).toBe(0);
    expect(sampled[sampled.length - 1]).toBe(39);
    expect(sampleEvenly(0, 16)).toEqual([]);
  });
});

describe("buildZip", () => {
  it("one entry per page + a graph.json that rebuilds the path", async () => {
    const jpg = await tinyJpeg();
    const bytes = await buildZip([page("a", jpg, null), page("b", jpg, "a")]);
    const zip = await JSZip.loadAsync(bytes);
    const names = Object.keys(zip.files);
    expect(names.filter((n) => n.endsWith(".jpg"))).toHaveLength(2);
    const graph = JSON.parse(await zip.file("graph.json")!.async("string"));
    expect(graph.exported_path).toHaveLength(2);
    expect(graph.exported_path[1].parent_id).toBe("a");
  });

  it("uses .png extension when bytes are PNG", async () => {
    const png = tinyPng();
    const bytes = await buildZip([page("a", png, null, "image/png")]);
    const zip = await JSZip.loadAsync(bytes);
    expect(Object.keys(zip.files).some((n) => n.endsWith(".png"))).toBe(true);
  });
});

describe("toWinAnsiLabel", () => {
  it("keeps ASCII and Latin-1; drops CJK that Helvetica cannot encode", () => {
    expect(toWinAnsiLabel("Steam Engine")).toBe("Steam Engine");
    expect(toWinAnsiLabel("café")).toBe("café");
    expect(toWinAnsiLabel("崇山峻岭")).toBe("");
    expect(toWinAnsiLabel("How 崇 works")).toBe("How works");
  });
});

describe("buildFlipbookPdf", () => {
  it("a real PDF with one page per image", async () => {
    const jpg = await tinyJpeg();
    const bytes = await buildFlipbookPdf([
      page("a", jpg, null),
      page("b", jpg, "a"),
      page("c", jpg, "b"),
    ]);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(3);
  });

  it("embeds PNG pages (OpenRouter image slugs)", async () => {
    const png = tinyPng();
    const bytes = await buildFlipbookPdf([page("a", png, null, "image/png")]);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });

  it("does not throw on CJK titles (WinAnsi / Helvetica limit)", async () => {
    const jpg = await tinyJpeg();
    const bytes = await buildFlipbookPdf([
      {
        ...page("a", jpg, null),
        title: "崇山峻岭 — How Mountains Form",
      },
    ]);
    expect(new TextDecoder().decode(bytes.slice(0, 5))).toBe("%PDF-");
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(1);
  });
});

describe("decodeImageToRgba + buildGif", () => {
  it("decodes PNG to RGBA", async () => {
    const png = tinyPng();
    const frame = await decodeImageToRgba(png, "image/png");
    expect(frame.width).toBe(2);
    expect(frame.height).toBe(2);
    expect(frame.data.length).toBe(16);
  });

  it("normalizes mixed frame sizes before encoding", () => {
    const a = { width: 4, height: 4, data: new Uint8Array(64).fill(100) };
    const b = { width: 6, height: 4, data: new Uint8Array(96).fill(200) };
    const out = normalizeGifFrames([a, b]);
    expect(out.every((f) => f.width === 6 && f.height === 4)).toBe(true);
  });

  it("an animated GIF89a from RGBA frames", async () => {
    const frame = {
      width: 4,
      height: 4,
      data: new Uint8Array(4 * 4 * 4).fill(180),
    };
    const bytes = await buildGif([frame, frame]);
    expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe("GIF89a");
  });

  it("builds a GIF from PNG-decoded frames", async () => {
    const png = tinyPng();
    const frame = await decodeImageToRgba(png, "image/png");
    const bytes = await buildGif([frame, frame]);
    expect(new TextDecoder().decode(bytes.slice(0, 6))).toBe("GIF89a");
  });
});
