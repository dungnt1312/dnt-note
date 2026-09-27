import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { MediaGrid } from "./MediaGrid";
import type { MediaItem } from "../../lib/api/media";

const items: MediaItem[] = [
  { name: "a-pic.png", displayName: "pic.png", ext: "png", kind: "image", size: 1, modified: "2026-01-01T00:00:00Z", usedBy: [] },
  { name: "b-doc.pdf", displayName: "doc.pdf", ext: "pdf", kind: "document", size: 1, modified: "2026-01-01T00:00:00Z", usedBy: [] },
];

describe("MediaGrid", () => {
  it("renders cards and selects on click", () => {
    const onSelect = vi.fn();
    render(<MediaGrid items={items} selectedName="b-doc.pdf" onSelect={onSelect} />);
    expect(screen.getByText("pic.png")).toBeInTheDocument();
    expect(screen.getByText("pdf")).toBeInTheDocument();
    expect(screen.getByTitle("doc.pdf")).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(screen.getByTitle("pic.png"));
    expect(onSelect).toHaveBeenCalledWith("a-pic.png");
  });
});
