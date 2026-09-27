import { describe, expect, it } from "vitest";
import { activeTriggerQuery } from "./triggers";

describe("activeTriggerQuery", () => {
  it.each([
    ["@ro", "ro"],
    ["gọi tới @", ""],
    ["(@note", "note"],
    ["— @roadmap", "roadmap"],
    ["start\n@", ""],
    ["đánh giá @Hồ", "Hồ"],
    ["@Hồ sơ", null], // caret after "sơ" → the active query ended at the space
  ])("%s → %j", (input, expected) => {
    expect(activeTriggerQuery(input)).toBe(expected);
  });

  it.each(["user@host", "a@b", "x_@y"])("%s does not trigger", (input) => {
    expect(activeTriggerQuery(input)).toBeNull();
  });

  it("query ends at whitespace or another @", () => {
    expect(activeTriggerQuery("@road map")).toBeNull();
    expect(activeTriggerQuery("@one @tw")).toBe("tw");
    expect(activeTriggerQuery("@a@b")).toBeNull();
  });
});
