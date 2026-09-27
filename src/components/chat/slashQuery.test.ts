import { describe, it, expect } from "vitest";
import { slashQuery } from "./Composer";

describe("slashQuery", () => {
  it("activates at start of text", () => {
    expect(slashQuery("/", 1)).toBe("");
    expect(slashQuery("/tom", 4)).toBe("tom");
  });
  it("activates after whitespace", () => {
    expect(slashQuery("hãy /tom", 8)).toBe("tom");
    expect(slashQuery("a\n/x", 4)).toBe("x");
  });
  it("is inactive mid-word, after whitespace in query, or in paths", () => {
    expect(slashQuery("a/b", 3)).toBeNull();
    expect(slashQuery("/tom tat", 8)).toBeNull();
    expect(slashQuery("http://x", 8)).toBeNull();
    expect(slashQuery("text", 4)).toBeNull();
  });
  it("uses the caret position", () => {
    expect(slashQuery("/ab rest", 3)).toBe("ab");
  });
});
