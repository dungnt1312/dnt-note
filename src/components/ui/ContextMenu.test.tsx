import { describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";
import { ContextMenu } from "./ContextMenu";
import { MenuItem } from "./Menu";

const Harness = ({ onClose, onSelect }: { onClose: () => void; onSelect: () => void }) => (
  <ContextMenu x={30} y={40} onClose={onClose}>
    <MenuItem onSelect={onSelect}>Làm gì đó</MenuItem>
  </ContextMenu>
);

describe("ContextMenu", () => {
  it("renders a portal menu with its items", () => {
    render(<Harness onClose={vi.fn()} onSelect={vi.fn()} />);
    expect(screen.getByRole("menu")).toBeTruthy();
    expect(screen.getByRole("menuitem", { name: "Làm gì đó" })).toBeTruthy();
  });

  it("closes on Escape and on outside mousedown, not on inside mousedown", () => {
    const onClose = vi.fn();
    render(<Harness onClose={onClose} onSelect={vi.fn()} />);
    fireEvent.keyDown(document, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(screen.getByRole("menu"));
    expect(onClose).toHaveBeenCalledTimes(1);
    fireEvent.mouseDown(document.body);
    expect(onClose).toHaveBeenCalledTimes(2);
  });

  it("item click runs close() before onSelect (MenuContext contract)", () => {
    const onClose = vi.fn();
    const onSelect = vi.fn();
    render(<Harness onClose={onClose} onSelect={onSelect} />);
    fireEvent.click(screen.getByRole("menuitem", { name: "Làm gì đó" }));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledTimes(1);
  });
});
