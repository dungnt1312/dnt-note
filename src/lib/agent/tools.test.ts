import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/notes", () => {
  const note = { id: "n1", title: "T", tags: [], pinned: false, created: "", updated: "", snippet: "s", wordCount: 1, body: "b" };
  return {
    api: {
      notes: {
        list: vi.fn(async () => [note]),
        search: vi.fn(async () => [note]),
        backlinks: vi.fn(async () => [note]),
        read: vi.fn(async () => note),
        create: vi.fn(async () => note),
        update: vi.fn(async () => note),
        del: vi.fn(async () => {}),
        tags: vi.fn(async () => [{ name: "a", count: 1 }]),
        stats: vi.fn(async () => ({ total: 1, pinned: 0, words: 1, tags: 1 })),
      },
    },
  };
});

vi.mock("../api/media", () => ({
  mediaApi: {
    list: vi.fn(async () => [
      { name: "u-a.pdf", displayName: "a.pdf", ext: "pdf", kind: "document", size: 10, modified: "", usedBy: [{ id: "n1", title: "T" }] },
    ]),
    dirPath: vi.fn(async () => "C:\\data\\attachments"),
  },
}));
vi.mock("../api/skills", () => ({
  skillsApi: {
    read: vi.fn(async (name: string) => {
      if (name === "off") return { name, description: "", enabled: false, body: "x" };
      if (name === "ok") return { name, description: "d", enabled: true, body: "BODY" };
      throw "Không tìm thấy skill";
    }),
  },
}));
vi.mock("../api/attachments", () => ({
  attachmentsApi: { extractText: vi.fn(async () => "x".repeat(25000)) },
}));

const toolSettings = vi.hoisted(() => ({ semanticIndexing: true }));
vi.mock("../store/settingsStore", () => ({
  useSettingsStore: {
    getState: () => ({
      semanticIndexing: toolSettings.semanticIndexing,
      activeProvider: () => ({ id: "p", name: "P", baseUrl: "http://x", model: "m", apiKey: "" }),
    }),
  },
}));

import { api } from "../api/notes";
import { mediaApi } from "../api/media";
import { attachmentsApi } from "../api/attachments";
import { AGENT_TOOLS, executeTool, type ToolArgs } from "./tools";

const mocked = vi.mocked(api.notes, true);

describe("AGENT_TOOLS", () => {
  const expected = [
    "list_notes", "search_notes", "read_note", "create_note", "update_note",
    "delete_note", "get_stats", "list_tags", "set_tags", "get_recent_notes",
    "list_media", "read_attachment", "load_skill", "get_backlinks", "semantic_search",
  ];
  it("has exactly the 15 tools with descriptions and object parameters", () => {
    expect(AGENT_TOOLS.map((t) => t.function.name).sort()).toEqual([...expected].sort());
    for (const t of AGENT_TOOLS) {
      expect(t.type).toBe("function");
      expect(t.function.description.length).toBeGreaterThan(5);
      expect(t.function.parameters).toHaveProperty("type", "object");
    }
  });
});

describe("executeTool", () => {
  beforeEach(() => vi.clearAllMocks());

  it("load_skill returns body, errors when disabled or missing", async () => {
    expect(JSON.parse(await executeTool("load_skill", { name: "ok" }))).toEqual({ name: "ok", body: "BODY" });
    expect(JSON.parse(await executeTool("load_skill", { name: "off" })).error).toBeTruthy();
    expect(JSON.parse(await executeTool("load_skill", { name: "nope" })).error).toBeTruthy();
    const { skillsApi } = await import("../api/skills");
    vi.mocked(skillsApi.read).mockClear();
    for (const bad of ["../x", "A", "a b", "", "x".repeat(65)]) {
      expect(JSON.parse(await executeTool("load_skill", { name: bad })).error).toBeTruthy();
    }
    expect(skillsApi.read).not.toHaveBeenCalled();
    const schema = AGENT_TOOLS.find((t) => t.function.name === "load_skill");
    expect(schema?.function.parameters).toMatchObject({ required: ["name"] });
  });

  it("list_media maps usedBy to titles", async () => {
    const out = JSON.parse(await executeTool("list_media", {}));
    expect(out).toEqual([{ name: "u-a.pdf", displayName: "a.pdf", kind: "document", size: 10, usedBy: ["T"] }]);
  });

  it("read_attachment extracts and truncates text", async () => {
    const out = JSON.parse(await executeTool("read_attachment", { name: "u-a.pdf" }));
    expect(vi.mocked(attachmentsApi.extractText)).toHaveBeenCalledWith("C:\\data\\attachments\\u-a.pdf");
    expect(out.text).toHaveLength(20000);
    expect(out.truncated).toBe(true);
  });

  it("read_attachment rejects path traversal", async () => {
    for (const bad of ["../x.pdf", "a/b.pdf", "a\\b.pdf", ""]) {
      const out = JSON.parse(await executeTool("read_attachment", { name: bad }));
      expect(out.error).toBeTruthy();
    }
    expect(vi.mocked(attachmentsApi.extractText)).not.toHaveBeenCalled();
    expect(vi.mocked(mediaApi.dirPath)).not.toHaveBeenCalled();
  });

  it("read_attachment returns error JSON when extraction fails", async () => {
    vi.mocked(attachmentsApi.extractText).mockRejectedValueOnce(new Error("boom"));
    const out = JSON.parse(await executeTool("read_attachment", { name: "u-a.pdf" }));
    expect(out.error).toContain("boom");
  });

  it("list_notes with offset/limit", async () => {
    const out = await executeTool("list_notes", { offset: 0, limit: 5 } as ToolArgs);
    expect(mocked.list).toHaveBeenCalledWith();
    expect(JSON.parse(out)).toHaveLength(1);
  });

  it("get_backlinks passes id", async () => {
    await executeTool("get_backlinks", { id: "n1" } as ToolArgs);
    expect(mocked.backlinks).toHaveBeenCalledWith("n1");
  });

  it("search_notes passes query", async () => {
    await executeTool("search_notes", { query: "abc" } as ToolArgs);
    expect(mocked.search).toHaveBeenCalledWith("abc", 10);
  });

  it("read_note passes id", async () => {
    const out = await executeTool("read_note", { id: "n1" } as ToolArgs);
    expect(mocked.read).toHaveBeenCalledWith("n1");
    expect(JSON.parse(out)).toHaveProperty("body", "b");
  });

  it("create_note passes title/body/tags", async () => {
    await executeTool("create_note", { title: "X", body: "Y", tags: ["t"] } as ToolArgs);
    expect(mocked.create).toHaveBeenCalledWith("X", "Y", ["t"]);
  });

  it("update_note maps patch fields", async () => {
    await executeTool("update_note", { id: "n1", title: "new" } as ToolArgs);
    expect(mocked.update).toHaveBeenCalledWith("n1", { title: "new", source: "agent" });
  });

  it("delete_note does NOT delete — returns pendingDelete", async () => {
    const out = await executeTool("delete_note", { id: "n1" } as ToolArgs);
    expect(mocked.del).not.toHaveBeenCalled();
    expect(JSON.parse(out)).toMatchObject({ pendingDelete: "n1" });
    expect(out).toContain("xác nhận");
  });

  it("set_tags maps to update", async () => {
    await executeTool("set_tags", { id: "n1", tags: ["a", "b"] } as ToolArgs);
    expect(mocked.update).toHaveBeenCalledWith("n1", { tags: ["a", "b"], source: "agent" });
  });

  it("get_recent_notes uses list", async () => {
    await executeTool("get_recent_notes", { limit: 3 } as ToolArgs);
    expect(mocked.list).toHaveBeenCalledWith();
  });

  it("unknown tool returns error JSON", async () => {
    const out = await executeTool("nope", {});
    expect(JSON.parse(out)).toHaveProperty("error");
  });
});

describe("semantic_search tool", () => {
  it("returns a friendly error when no embedding model is configured", async () => {
    const out = JSON.parse(await executeTool("semantic_search", { query: "abc" }));
    expect(out.error).toContain("Chưa cấu hình model embeddings");
  });
  it("returns the consent message when semantic indexing is off", async () => {
    toolSettings.semanticIndexing = false;
    const out = JSON.parse(await executeTool("semantic_search", { query: "abc" }));
    toolSettings.semanticIndexing = true;
    expect(out.error).toContain("Tìm theo ý nghĩa đang tắt");
  });
});
