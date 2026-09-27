import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../env", () => ({ isTauri: true }));
vi.mock("../api/media", () => ({
  mediaApi: {
    list: vi.fn(async () => []),
    rename: vi.fn(async () => "x-new.png"),
    del: vi.fn(async () => {}),
    import: vi.fn(async (p: string) => {
      if (p.includes("bad")) throw "Định dạng không hỗ trợ";
      return { name: `id-${p}`, size: 1 };
    }),
    dirPath: vi.fn(async () => "/att"),
  },
}));

import { mediaApi } from "../api/media";
import type { MediaItem } from "../api/media";
import { useMediaStore } from "./mediaStore";
import { useNotesStore } from "./notesStore";

const item: MediaItem = {
  name: "a-pic.png", displayName: "pic.png", ext: "png", kind: "image", size: 1,
  modified: "2026-01-01T00:00:00Z", usedBy: [{ id: "n1", title: "N" }],
};

describe("mediaStore ops", () => {
  const flushSave = vi.fn(async () => {});
  const reloadBody = vi.fn(async () => {});

  beforeEach(() => {
    vi.clearAllMocks();
    useMediaStore.setState({ items: [item], selectedName: item.name });
    useNotesStore.setState({ selectedId: "n1", flushSave, reloadBody });
  });

  it("remove saves then reloads the open note that uses the file, and reloads the list", async () => {
    await useMediaStore.getState().remove(item.name, true);
    expect(flushSave).toHaveBeenCalled();
    expect(mediaApi.del).toHaveBeenCalledWith(item.name, true);
    expect(reloadBody).toHaveBeenCalledWith("n1");
    expect(flushSave.mock.invocationCallOrder[0]).toBeLessThan(vi.mocked(mediaApi.del).mock.invocationCallOrder[0]);
    expect(mediaApi.list).toHaveBeenCalled();
    expect(useMediaStore.getState().selectedName).toBeNull();
  });

  it("rename leaves an unrelated open note alone", async () => {
    useNotesStore.setState({ selectedId: "other" });
    vi.mocked(mediaApi.list).mockResolvedValueOnce([{ ...item, name: "x-new.png" }]);
    await useMediaStore.getState().rename(item.name, "new.png");
    expect(flushSave).not.toHaveBeenCalled();
    expect(reloadBody).not.toHaveBeenCalled();
    expect(useMediaStore.getState().selectedName).toBe("x-new.png");
  });

  it("importFiles continues past failures and reports the first error", async () => {
    const r = await useMediaStore.getState().importFiles(["a.png", "bad.exe", "c.pdf"]);
    expect(r).toEqual({ imported: 2, total: 3, firstError: "Định dạng không hỗ trợ" });
    expect(mediaApi.import).toHaveBeenCalledTimes(3);
    expect(mediaApi.list).toHaveBeenCalled();
  });
});
