import { describe, it, expect } from "vitest";
import {
  bytesToBase64,
  countAttachmentRefs,
  encodeLinkName,
  isSafeName,
  markdownLinkFor,
  percentDecode,
  targetCandidates,
} from "./insertLink";

const U = "123e4567-e89b-12d3-a456-426614174000";

describe("encodeLinkName (shared vectors with Rust)", () => {
  it("encodes only % and space", () => {
    expect(encodeLinkName("a b.png")).toBe("a%20b.png");
    expect(encodeLinkName("report%20final.pdf")).toBe("report%2520final.pdf");
    expect(encodeLinkName("x(1).png")).toBe("x(1).png");
    expect(encodeLinkName("x (1).png")).toBe("x%20(1).png");
  });
});

describe("markdownLinkFor", () => {
  it("uses image syntax for images and strips the uuid prefix", () => {
    expect(markdownLinkFor(`${U}-cat.PNG`)).toBe(`![cat.PNG](attachments/${U}-cat.PNG)`);
  });
  it("uses a plain link for other files with canonical encoding", () => {
    expect(markdownLinkFor(`${U}-my report (1).pdf`)).toBe(
      `[my report (1).pdf](attachments/${U}-my%20report%20(1).pdf)`,
    );
    expect(markdownLinkFor("50%.txt")).toBe("[50%.txt](attachments/50%25.txt)");
  });
});

describe("percentDecode / targetCandidates", () => {
  it("mirrors Rust", () => {
    expect(percentDecode("a%C3%A1")).toBe("aá");
    expect(percentDecode("50%")).toBe("50%");
    expect(percentDecode("%FF")).toBeNull();
    expect(targetCandidates("a%20b.png")).toEqual(["a%20b.png", "a b.png"]);
    expect(targetCandidates("%2E%2E")).toEqual(["%2E%2E"]);
    expect(targetCandidates("..")).toEqual([]);
  });
});

describe("isSafeName", () => {
  it("rejects trailing dot or space (Windows strips them)", () => {
    for (const bad of ["a.png.", "a.png ", "x.", "y "]) expect(isSafeName(bad)).toBe(false);
    expect(isSafeName(".hidden.png")).toBe(true);
  });
});

describe("countAttachmentRefs", () => {
  it("counts files by canonical decoded name (shared vector with Rust)", () => {
    const body = "![a](attachments/a%20b.png) ![b](attachments/a b.png) [c](attachments/c.pdf) [d](attachments/c.pdf)";
    expect(countAttachmentRefs(body)).toBe(2);
  });
  it("counts unique files with balanced parens", () => {
    const body = [
      "![a](attachments/x (1).png)",
      "[b](attachments/x%20(1).png)",
      "[c](attachments/y.pdf) [d](attachments/y.pdf)",
      "(attachments/..)",
      "(attachments/open",
      "next)",
    ].join("\n");
    expect(countAttachmentRefs(body)).toBe(2);
    expect(countAttachmentRefs("")).toBe(0);
  });
});

describe("bytesToBase64", () => {
  it("encodes bytes", () => {
    expect(bytesToBase64(new Uint8Array([104, 105, 0, 255]))).toBe(btoa("hi\u0000\u00ff"));
    expect(bytesToBase64(new Uint8Array(70000).fill(65))).toBe(btoa("A".repeat(70000)));
  });
});
