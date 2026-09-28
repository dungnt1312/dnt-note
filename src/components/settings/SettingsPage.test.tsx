import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";

vi.mock("@tauri-apps/plugin-store", () => ({
  load: vi.fn(async () => {
    throw new Error("not in tauri");
  }),
}));

import { useSettingsStore } from "../../lib/store/settingsStore";
import { useLangStore } from "../../lib/i18n";
import { SettingsPage } from "./SettingsPage";

describe("SettingsPage tabs", () => {
  beforeEach(() => {
    localStorage.clear();
    useLangStore.setState({ lang: "vi" });
    useSettingsStore.setState({
      providers: [
        { id: "p1", name: "Proxy", baseUrl: "http://x/v1", apiKey: "k", model: "m", models: ["m"] },
      ],
      activeProviderId: "p1",
      loaded: true,
    });
  });

  it("shows only the active tab's sections", () => {
    render(<SettingsPage />);

    // Default tab "Chung": appearance + about, nothing else.
    expect(screen.getByRole("tab", { name: "Chung" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("heading", { name: "Giao diện" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "Giới thiệu" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Nhà cung cấp AI" })).not.toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Phím tắt" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Nhà cung cấp AI" }));
    expect(screen.getByRole("tab", { name: "Nhà cung cấp AI" })).toHaveAttribute("aria-selected", "true");
    expect(screen.getByRole("textbox", { name: "Tên nhà cung cấp" })).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Giao diện" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Dữ liệu" }));
    expect(screen.getByRole("button", { name: /Mở thư mục/ })).toBeInTheDocument();
    expect(screen.queryByRole("textbox", { name: "Tên nhà cung cấp" })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole("tab", { name: "Phím tắt" }));
    expect(screen.getByText("Hoàn tác xóa")).toBeInTheDocument();
    expect(screen.queryByRole("heading", { name: "Giới thiệu" })).not.toBeInTheDocument();
  });

  it("switching language re-renders the UI in the chosen language", () => {
    render(<SettingsPage />);

    fireEvent.click(screen.getByRole("radio", { name: "English" }));
    expect(screen.getByRole("heading", { name: "Settings" })).toBeInTheDocument();
    expect(screen.getByRole("tab", { name: "AI providers" })).toBeInTheDocument();
    expect(useLangStore.getState().lang).toBe("en");
    expect(localStorage.getItem("dnt-lang")).toBe("en");

    fireEvent.click(screen.getByRole("radio", { name: "Tiếng Việt" }));
    expect(screen.getByRole("heading", { name: "Cài đặt" })).toBeInTheDocument();
    expect(useLangStore.getState().lang).toBe("vi");
  });
});
