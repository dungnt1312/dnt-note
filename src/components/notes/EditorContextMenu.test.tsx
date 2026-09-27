import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { EditorContextMenu } from "./EditorContextMenu";

const base = () => ({
  x: 10,
  y: 20,
  onClose: vi.fn(),
  onSelection: vi.fn(),
  onWholeNote: vi.fn(),
  onCopy: vi.fn(),
});

describe("EditorContextMenu", () => {
  it("with selection: offers send-to-AI and copy", () => {
    const props = base();
    render(<EditorContextMenu {...props} hasSelection />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Gửi vào Trợ lý AI" }));
    expect(props.onSelection).toHaveBeenCalledTimes(1);
    expect(props.onClose).toHaveBeenCalledTimes(1); // MenuItem closes before onSelect
    expect(screen.getByRole("menuitem", { name: "Sao chép" })).toBeTruthy();
  });

  it("without selection: offers ask-AI-about-this-note only", () => {
    const props = base();
    render(<EditorContextMenu {...props} hasSelection={false} />);
    expect(screen.queryByRole("menuitem", { name: "Gửi vào Trợ lý AI" })).toBeNull();
    fireEvent.click(screen.getByRole("menuitem", { name: "Hỏi AI về ghi chú này" }));
    expect(props.onWholeNote).toHaveBeenCalledTimes(1);
  });
});
