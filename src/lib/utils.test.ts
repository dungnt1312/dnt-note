import { describe, it, expect } from "vitest";
import { cn } from "./utils";

describe("cn", () => {
  it("keeps Studio font-size utilities next to text colors", () => {
    expect(cn("text-caption text-fg-tertiary")).toBe("text-caption text-fg-tertiary");
    expect(cn("text-callout", "text-accent-fg")).toBe("text-callout text-accent-fg");
    expect(cn("text-large-title font-bold", "text-fg")).toBe("text-large-title font-bold text-fg");
  });

  it("still dedupes conflicting sizes and colors", () => {
    expect(cn("text-callout", "text-footnote")).toBe("text-footnote");
    expect(cn("text-fg", "text-danger")).toBe("text-danger");
  });
});
