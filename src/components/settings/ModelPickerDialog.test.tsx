import { describe, it, expect, vi, beforeAll } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { ModelPickerDialog } from "./ModelPickerDialog";

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

type Props = Parameters<typeof ModelPickerDialog>[0];

function setup(overrides: Partial<Props> = {}) {
  const props: Props = {
    open: true,
    providerName: "Proxy",
    saved: ["grok-4.5"],
    loadModels: vi.fn(async () => ["gpt-4o", "grok-4.5", "claude-sonnet-4"]),
    onSave: vi.fn(),
    onClose: vi.fn(),
    ...overrides,
  };
  render(<ModelPickerDialog {...props} />);
  return props;
}

describe("ModelPickerDialog", () => {
  it("checks the saved models and saves newly ticked ones after them", async () => {
    const props = setup();
    const gpt = await screen.findByRole("option", { name: "gpt-4o" });
    expect(screen.getByRole("option", { name: "grok-4.5" })).toHaveAttribute("aria-selected", "true");
    expect(gpt).toHaveAttribute("aria-selected", "false");

    fireEvent.click(gpt);
    fireEvent.click(screen.getByRole("option", { name: "claude-sonnet-4" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(props.onSave).toHaveBeenCalledWith(["grok-4.5", "gpt-4o", "claude-sonnet-4"]);
  });

  it("unticking a saved model drops it", async () => {
    const props = setup();
    await screen.findByRole("option", { name: "gpt-4o" });
    fireEvent.click(screen.getByRole("option", { name: "grok-4.5" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(props.onSave).toHaveBeenCalledWith([]);
  });

  it("search narrows the list", async () => {
    setup();
    await screen.findByRole("option", { name: "gpt-4o" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: "claude" } });
    expect(screen.getByRole("option", { name: "claude-sonnet-4" })).toBeInTheDocument();
    expect(screen.queryByRole("option", { name: "gpt-4o" })).not.toBeInTheDocument();
  });

  it("Enter toggles the highlighted model", async () => {
    const props = setup();
    await screen.findByRole("option", { name: "gpt-4o" });
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "gpt" } });
    fireEvent.keyDown(input, { key: "Enter" });
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(props.onSave).toHaveBeenCalledWith(["grok-4.5", "gpt-4o"]);
  });

  it("a name that is not in the list can be added by hand", async () => {
    const props = setup();
    await screen.findByRole("option", { name: "gpt-4o" });
    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "my-finetune" } });
    fireEvent.keyDown(input, { key: "Enter" });
    expect(screen.getByRole("option", { name: "my-finetune" })).toHaveAttribute("aria-selected", "true");
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(props.onSave).toHaveBeenCalledWith(["grok-4.5", "my-finetune"]);
  });

  it("shows why the list failed to load and keeps manual entry working", async () => {
    const props = setup({
      loadModels: vi.fn(async () => {
        throw new Error("LLM 401: bad key");
      }),
    });
    expect(await screen.findByText(/LLM 401: bad key/)).toBeInTheDocument();
    expect(screen.getByRole("option", { name: "grok-4.5" })).toHaveAttribute("aria-selected", "true");

    const input = screen.getByRole("combobox");
    fireEvent.change(input, { target: { value: "gpt-4o" } });
    fireEvent.click(screen.getByRole("option", { name: /Thêm/ }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));
    expect(props.onSave).toHaveBeenCalledWith(["grok-4.5", "gpt-4o"]);
  });

  it("Thử lại reloads the list and keeps focus in the search box", async () => {
    const loadModels = vi
      .fn<() => Promise<string[]>>()
      .mockRejectedValueOnce(new Error("offline"))
      .mockResolvedValueOnce(["gpt-4o"]);
    setup({ loadModels });
    const retry = await screen.findByRole("button", { name: "Thử lại" });
    retry.focus();
    fireEvent.click(retry);
    expect(await screen.findByRole("option", { name: "gpt-4o" })).toBeInTheDocument();
    expect(screen.getByRole("combobox")).toHaveFocus();
  });

  it("Hủy closes without saving", async () => {
    const props = setup();
    await screen.findByRole("option", { name: "gpt-4o" });
    fireEvent.click(screen.getByRole("button", { name: "Hủy" }));
    expect(props.onClose).toHaveBeenCalled();
    expect(props.onSave).not.toHaveBeenCalled();
  });
});
