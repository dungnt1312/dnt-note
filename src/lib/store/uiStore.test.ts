import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { useUi } from "./uiStore";

describe("uiStore toasts", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    useUi.setState({ toasts: [], paletteOpen: false, settingsOpen: false, tagFilter: null, searchQuery: "" });
  });
  afterEach(() => vi.useRealTimers());

  it("pushToast adds a toast with action and auto-expires after 10s", () => {
    const action = vi.fn();
    useUi.getState().pushToast({
      message: "Đã xóa ghi chú",
      actionLabel: "Hoàn tác",
      onAction: action,
    });
    expect(useUi.getState().toasts).toHaveLength(1);
    expect(useUi.getState().toasts[0].actionLabel).toBe("Hoàn tác");

    vi.advanceTimersByTime(10000);
    expect(useUi.getState().toasts).toHaveLength(0);
  });

  it("dismissToast removes it early", () => {
    useUi.getState().pushToast({ message: "x" });
    const id = useUi.getState().toasts[0].id;
    useUi.getState().dismissToast(id);
    expect(useUi.getState().toasts).toHaveLength(0);
  });

  it("supports custom duration", () => {
    useUi.getState().pushToast({ message: "x", durationMs: 500 });
    vi.advanceTimersByTime(500);
    expect(useUi.getState().toasts).toHaveLength(0);
  });
});
