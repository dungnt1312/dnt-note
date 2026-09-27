import { describe, it, expect } from "vitest";
import { filterMedia, countMedia } from "./mediaStore";
import type { MediaItem } from "../api/media";

function item(name: string, kind: MediaItem["kind"], used = 0): MediaItem {
  return {
    name,
    displayName: name.replace(/^\w+-/, ""),
    ext: name.split(".").pop() ?? "",
    kind,
    size: 10,
    modified: "2026-01-01T00:00:00Z",
    usedBy: Array.from({ length: used }, (_, i) => ({ id: `n${i}`, title: `Note ${i}` })),
  };
}

const items = [
  item("a1-Photo.PNG", "image", 1),
  item("b2-report.pdf", "document"),
  item("c3-voice.mp3", "audio", 2),
  item("d4-data.bin", "other"),
];

describe("filterMedia", () => {
  it("all returns everything", () => {
    expect(filterMedia(items, "all", "")).toHaveLength(4);
  });
  it("filters by kind", () => {
    expect(filterMedia(items, "image", "").map((i) => i.name)).toEqual(["a1-Photo.PNG"]);
    expect(filterMedia(items, "document", "").map((i) => i.name)).toEqual(["b2-report.pdf"]);
    expect(filterMedia(items, "audio", "").map((i) => i.name)).toEqual(["c3-voice.mp3"]);
  });
  it("unused keeps items with empty usedBy", () => {
    expect(filterMedia(items, "unused", "").map((i) => i.name)).toEqual(["b2-report.pdf", "d4-data.bin"]);
  });
  it("query is case-insensitive on displayName", () => {
    expect(filterMedia(items, "all", "photo").map((i) => i.name)).toEqual(["a1-Photo.PNG"]);
    expect(filterMedia(items, "all", "  REPORT ").map((i) => i.name)).toEqual(["b2-report.pdf"]);
    expect(filterMedia(items, "image", "report")).toEqual([]);
  });
  it("counts per filter", () => {
    expect(countMedia(items)).toEqual({ all: 4, image: 1, document: 1, audio: 1, unused: 2 });
  });
});
