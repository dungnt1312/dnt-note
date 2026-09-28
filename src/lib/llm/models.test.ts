import { describe, it, expect } from "vitest";
import { cleanModelList, mergeModelLists } from "./models";

describe("cleanModelList", () => {
  it("trims, drops blanks and keeps the first of each duplicate", () => {
    expect(cleanModelList([" gpt-4o ", "", "grok-4.5", "gpt-4o", "  "])).toEqual(["gpt-4o", "grok-4.5"]);
  });
});

describe("mergeModelLists", () => {
  it("keeps saved models first, then the fetched ones in natural order", () => {
    const merged = mergeModelLists(["grok-4.5", "custom-x"], ["gpt-10", "grok-4.5", "Claude-3", "gpt-4o"]);
    expect(merged).toEqual(["grok-4.5", "custom-x", "Claude-3", "gpt-4o", "gpt-10"]);
  });
});
