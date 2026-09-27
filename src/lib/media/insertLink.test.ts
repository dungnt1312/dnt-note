import { describe, it, expect } from "vitest";
import { bytesToBase64, countAttachmentRefs, markdownLinkFor } from "./insertLink";

const U = "123e4567-e89b-12d3-a456-426614174000";

describe("markdownLinkFor", () => {
  it("uses image syntax for images and strips the uuid prefix", () => {
    expect(markdownLinkFor(`${U}-cat.PNG`)).toBe(`![cat.PNG](attachments/${U}-cat.PNG)`);
  });
  it("uses a plain link for other files and encodes spaces only", () => {
    expect(markdownLinkFor(`${U}-my report (1).pdf`)).toBe(
      `[my report (1).pdf](attachments/${U}-my%20report%20(1).pdf)`,
    );
  });
  it("keeps names without a uuid prefix", () => {
    expect(markdownLinkFor("a.txt")).toBe("[a.txt](attachments/a.txt)");
  });
});

describe("countAttachmentRefs", () => {
  it("counts unique refs with balanced parens and decoding", () => {
    const body = [
      "![a](attachments/x (1).png)",
      "[b](attachments/x%20(1).png)",
      "[c](attachments/y.pdf) [d](attachments/y.pdf)",
      "(attachments/../evil)",
      "(attachments/open",
      "next)",
    ].join("\n");
    expect(countAttachmentRefs(body)).toBe(2);
  });
  it("returns 0 for empty body", () => {
    expect(countAttachmentRefs("")).toBe(0);
  });
});

describe("bytesToBase64", () => {
  it("encodes bytes", () => {
    expect(bytesToBase64(new Uint8Array([104, 105, 0, 255]))).toBe(btoa("hi\u0000\u00ff"));
    expect(bytesToBase64(new Uint8Array(70000).fill(65))).toBe(btoa("A".repeat(70000)));
  });
});
