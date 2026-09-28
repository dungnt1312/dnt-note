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

  it("a new toast replaces the current one", () => {
    useUi.getState().pushToast({ message: "a" });
    useUi.getState().pushToast({ message: "b" });
    expect(useUi.getState().toasts.map((t) => t.message)).toEqual(["b"]);
  });
});

describe("uiStore sections", () => {
  beforeEach(() => {
    useUi.setState({ section: "notes", workspace: "notes", settingsOpen: false });
  });

  it("switching to chat also switches the sidebar workspace", () => {
    useUi.getState().setSection("chat");
    expect(useUi.getState()).toMatchObject({ section: "chat", workspace: "chat" });
  });

  it("settings keeps the sidebar list and closing returns to the previous section", () => {
    useUi.getState().setSection("chat");
    useUi.getState().setSettingsOpen(true);
    expect(useUi.getState()).toMatchObject({ section: "settings", workspace: "chat", settingsOpen: true });
    useUi.getState().setSettingsOpen(false);
    expect(useUi.getState()).toMatchObject({ section: "chat", settingsOpen: false });
  });
});

describe("uiStore persistence", () => {
  beforeEach(() => {
    localStorage.clear();
    useUi.setState({
      searchQuery: "",
      tagFilter: null,
      folderFilter: null,
      section: "notes",
      workspace: "notes",
      sidebarVisible: true,
      chatOpen: false,
      settingsOpen: false,
      toasts: [],
      paletteOpen: false,
    });
  });

  it("writes layout state to localStorage and skips transient fields", () => {
    useUi.getState().setSection("chat");
    useUi.getState().setChatOpen(true);
    useUi.getState().toggleSidebar();
    useUi.getState().pushToast({ message: "t" });

    const raw = localStorage.getItem("dnt-ui-state");
    expect(raw).toBeTruthy();
    const saved = JSON.parse(raw!) as { state: Record<string, unknown> };
    expect(saved.state).toMatchObject({ section: "chat", workspace: "chat", chatOpen: true, sidebarVisible: false });
    expect(saved.state.toasts).toBeUndefined();
    expect(saved.state.paletteOpen).toBeUndefined();
  });

  it("restores layout after a reload and derives settingsOpen from the section", async () => {
    localStorage.setItem(
      "dnt-ui-state",
      JSON.stringify({
        state: {
          section: "settings",
          workspace: "chat",
          sidebarVisible: false,
          chatOpen: true,
          folderFilter: "Work",
          tagFilter: "a",
          searchQuery: "q",
        },
        version: 1,
      }),
    );

    await useUi.persist.rehydrate();

    expect(useUi.getState()).toMatchObject({
      section: "settings",
      workspace: "chat",
      sidebarVisible: false,
      chatOpen: true,
      folderFilter: "Work",
      tagFilter: "a",
      searchQuery: "q",
      settingsOpen: true,
    });
  });
});
