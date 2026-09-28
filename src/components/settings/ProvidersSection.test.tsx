import { describe, it, expect, vi, beforeAll, beforeEach } from "vitest";
import { render, screen, fireEvent, within } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => {
    throw new Error("not in tauri");
  }),
}));
vi.mock("../../lib/llm/openai", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/llm/openai")>()),
  listModels: vi.fn(async () => ["gpt-4o", "grok-4.5", "claude-sonnet-4"]),
}));

import { listModels } from "../../lib/llm/openai";
import { useSettingsStore } from "../../lib/store/settingsStore";
import { ProvidersSection } from "./ProvidersSection";

const provider = () => useSettingsStore.getState().providers[0];

beforeAll(() => {
  Element.prototype.scrollIntoView = vi.fn();
});

describe("ProvidersSection models", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      providers: [
        { id: "p1", name: "Proxy", baseUrl: "http://x/v1", apiKey: "k", model: "grok-4.5", models: ["grok-4.5"] },
      ],
      activeProviderId: "p1",
      loaded: true,
    });
  });

  it("models ticked in the picker are saved and shown as chips", async () => {
    render(<ProvidersSection />);
    fireEvent.click(screen.getByRole("button", { name: /Chọn model/ }));
    fireEvent.click(await screen.findByRole("option", { name: "gpt-4o" }));
    fireEvent.click(screen.getByRole("option", { name: "claude-sonnet-4" }));
    fireEvent.click(screen.getByRole("button", { name: "Lưu" }));

    expect(listModels).toHaveBeenCalledWith("http://x/v1", "k", undefined);
    expect(provider().models).toEqual(["grok-4.5", "gpt-4o", "claude-sonnet-4"]);
    const chips = screen.getByRole("group", { name: "Model" });
    expect(within(chips).getByRole("button", { name: "gpt-4o" })).toBeInTheDocument();
    expect(within(chips).getByRole("button", { name: "claude-sonnet-4" })).toBeInTheDocument();
    expect(screen.queryByRole("dialog")).not.toBeInTheDocument();
  });

  it("clicking a chip makes it the provider's model; × removes a model", () => {
    useSettingsStore.setState({ providers: [{ ...provider(), models: ["grok-4.5", "gpt-4o"] }] });
    render(<ProvidersSection />);

    fireEvent.click(screen.getByRole("button", { name: "gpt-4o" }));
    expect(provider().model).toBe("gpt-4o");
    expect(screen.getByRole("button", { name: "gpt-4o" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByRole("button", { name: "grok-4.5" })).toHaveAttribute("aria-pressed", "false");

    fireEvent.click(screen.getByRole("button", { name: "Bỏ model grok-4.5" }));
    expect(provider().models).toEqual(["gpt-4o"]);
  });

  it("typing in the name field renames the provider", () => {
    render(<ProvidersSection />);
    const nameInput = screen.getByLabelText("Tên nhà cung cấp") as HTMLInputElement;
    fireEvent.change(nameInput, { target: { value: "ClipProxy" } });
    expect(provider().name).toBe("ClipProxy");
    expect(nameInput.value).toBe("ClipProxy");
  });
});
