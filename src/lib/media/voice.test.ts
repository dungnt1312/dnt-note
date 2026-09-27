import { describe, expect, it } from "vitest";
import { formatElapsed, formatTranscript, voiceFileName, voiceLinkFor } from "./voice";
import { markdownLinkFor } from "./insertLink";

describe("voice helpers", () => {
  it("formats file name", () => {
    expect(voiceFileName(new Date(2026, 8, 7, 5, 4, 3))).toBe("ghi-am-20260907-050403.webm");
  });
  it("formats elapsed", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(65_999)).toBe("01:05");
    expect(formatElapsed(600_000)).toBe("10:00");
  });
  it("formats transcript as blockquote", () => {
    expect(formatTranscript("  a \n\n b  ")).toBe("> a\n>\n> b");
    expect(formatTranscript("   ")).toBe("");
  });
  it("prefixes mic to link", () => {
    expect(voiceLinkFor(markdownLinkFor("ghi-am-1.webm"))).toBe("[🎙 ghi-am-1.webm](attachments/ghi-am-1.webm)");
  });
});
