import { describe, it, expect, vi, afterEach } from "vitest";

vi.mock("@tauri-apps/api/core", () => ({
  convertFileSrc: (p: string) => `http://asset.localhost/${encodeURIComponent(p)}`,
}));

import { attachmentUrl, rewriteAttachmentSrc, setAttachmentsDirForTest } from "./attachmentUrl";

afterEach(() => setAttachmentsDirForTest(null));

describe("rewriteAttachmentSrc", () => {
  it("leaves urls unchanged when the dir is not resolved", () => {
    expect(rewriteAttachmentSrc("attachments/a.png")).toBe("attachments/a.png");
    expect(attachmentUrl("a.png")).toBe("");
  });

  it("maps attachments/<name> to an asset url when the dir is set", () => {
    setAttachmentsDirForTest("C:\\data\\attachments");
    expect(rewriteAttachmentSrc("attachments/u-image (1).png")).toBe(
      `http://asset.localhost/${encodeURIComponent("C:\\data\\attachments\\u-image (1).png")}`,
    );
  });

  it("decodes percent-encoded names before building the url", () => {
    setAttachmentsDirForTest("/data/attachments");
    expect(rewriteAttachmentSrc("attachments/a%20b.png")).toBe(
      `http://asset.localhost/${encodeURIComponent("/data/attachments/a b.png")}`,
    );
  });

  it("leaves other urls unchanged", () => {
    setAttachmentsDirForTest("/data/attachments");
    expect(rewriteAttachmentSrc("https://x.com/a.png")).toBe("https://x.com/a.png");
    expect(rewriteAttachmentSrc("img/a.png")).toBe("img/a.png");
  });
});
