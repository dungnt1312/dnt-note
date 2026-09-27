import { describe, it, expect } from "vitest";
import { mentionQuery, slashQuery, matchSkills } from "./queries";

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

describe("mentionQuery", () => {
  it("detects @ queries", () => {
    expect(mentionQuery("hi @ab", 6)).toBe("ab");
    expect(mentionQuery("a@b", 3)).toBeNull();
  });
});

describe("matchSkills", () => {
  const skills = [
    { name: "meeting-notes", enabled: true },
    { name: "me", enabled: true },
    { name: "memo-off", enabled: false },
    { name: "summary", enabled: true },
  ];
  const pick = (text: string, exclude: string[] = []) => {
    const q = slashQuery(text, text.length);
    return q === null ? [] : matchSkills(skills, q, exclude).map((s) => s.name);
  };
  it("no match for non-prefix queries (paths)", () => {
    expect(pick("xem /src")).toEqual([]);
  });
  it("prefix match, case-insensitive, shortest first", () => {
    expect(pick("/me")).toEqual(["me", "meeting-notes"]);
    expect(pick("/ME")).toEqual(["me", "meeting-notes"]);
    expect(pick("/eet")).toEqual([]);
  });
  it("empty query shows all enabled, minus excluded", () => {
    expect(pick("/", ["me"])).toEqual(["summary", "meeting-notes"].sort((a, b) => a.length - b.length));
  });
});
