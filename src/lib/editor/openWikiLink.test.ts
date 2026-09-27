import { describe, it, expect, vi } from "vitest";

const note = { id: "x", title: "Mới", tags: [], pinned: false, created: "", updated: "", snippet: "", wordCount: 0, body: "" };
let resolveCreate: (v: typeof note) => void = () => {};
vi.mock("../api/notes", () => ({
  api: {
    notes: {
      create: vi.fn(() => new Promise((r) => (resolveCreate = r))),
      read: vi.fn(async () => note),
      list: vi.fn(async () => [note]),
      tags: vi.fn(async () => []),
      snapshot: vi.fn(async () => null),
      update: vi.fn(async () => note),
    },
  },
}));

import { api } from "../api/notes";
import { openWikiLink } from "./openWikiLink";

describe("openWikiLink", () => {
  it("ignores a second click while the create is pending", async () => {
    const a = openWikiLink("Mới");
    const b = openWikiLink("  mới ");
    expect(vi.mocked(api.notes.create)).toHaveBeenCalledTimes(1);
    resolveCreate(note);
    await Promise.all([a, b]);
    expect(vi.mocked(api.notes.create)).toHaveBeenCalledTimes(1);
  });
});
