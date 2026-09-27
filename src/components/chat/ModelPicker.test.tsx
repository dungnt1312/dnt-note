import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => {
    throw new Error("not in tauri");
  }),
}));

import { ModelPicker } from "./ModelPicker";
import { useSettingsStore } from "../../lib/store/settingsStore";

describe("ModelPicker", () => {
  beforeEach(() => {
    localStorage.clear();
    useSettingsStore.setState({
      providers: [
        { id: "a", name: "Proxy", baseUrl: "http://a", apiKey: "", model: "grok-4.5", models: ["grok-4.5", "gpt-4o"] },
        { id: "b", name: "Ollama", baseUrl: "http://b", apiKey: "", model: "llama3.1", models: ["llama3.1"] },
      ],
      activeProviderId: "a",
      loaded: true,
    });
  });

  it("lists every saved model grouped by provider, current one checked", () => {
    render(<ModelPicker compact={false} />);
    fireEvent.click(screen.getByRole("button", { name: /grok-4\.5/ }));
    const proxy = screen.getByRole("group", { name: "Proxy" });
    expect(proxy).toHaveTextContent("grok-4.5");
    expect(proxy).toHaveTextContent("gpt-4o");
    expect(screen.getByRole("group", { name: "Ollama" })).toHaveTextContent("llama3.1");
    expect(screen.getByRole("menuitemradio", { name: "grok-4.5" })).toHaveAttribute("aria-checked", "true");
    expect(screen.getByRole("menuitemradio", { name: "gpt-4o" })).toHaveAttribute("aria-checked", "false");
  });

  it("opening the menu puts keyboard focus on the current model", async () => {
    useSettingsStore.setState({ activeProviderId: "b" });
    render(<ModelPicker compact={false} />);
    fireEvent.click(screen.getByRole("button", { name: /llama3\.1/ }));
    await waitFor(() => expect(screen.getByRole("menuitemradio", { name: "llama3.1" })).toHaveFocus());
  });

  it("picking a model of another provider switches provider and model", () => {
    render(<ModelPicker compact={false} />);
    fireEvent.click(screen.getByRole("button", { name: /grok-4\.5/ }));
    fireEvent.click(screen.getByRole("menuitemradio", { name: "llama3.1" }));
    const s = useSettingsStore.getState();
    expect(s.activeProviderId).toBe("b");
    expect(s.activeProvider()?.model).toBe("llama3.1");
    expect(screen.getByRole("button", { name: /llama3\.1/ })).toBeInTheDocument();
  });
});
