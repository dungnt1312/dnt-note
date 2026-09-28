import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

vi.mock("@tauri-apps/api/core", () => ({ invoke: vi.fn(async () => undefined) }));
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: vi.fn() }));

import { ChatPanel } from "./ChatPanel";
import { useChatStore, newId } from "../../lib/store/chatStore";
import { useComposerStore } from "../../lib/store/composerStore";
import { useSettingsStore } from "../../lib/store/settingsStore";
import { useNotesStore } from "../../lib/store/notesStore";
import { useUi } from "../../lib/store/uiStore";

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollTo", { configurable: true, value: vi.fn() });
  useChatStore.setState({
    chatId: newId(),
    chatTitle: "Phiên chat mới",
    messages: [],
    status: "idle",
    error: null,
    sessions: [],
  });
  useComposerStore.setState({ drafts: {}, pendingContext: null });
  useSettingsStore.setState({ loaded: true });
  useNotesStore.setState({ notes: [], selectedId: null, tags: [] });
  useUi.setState({ section: "chat", chatOpen: false });
});

describe("ChatPanel composer lifecycle", () => {
  it("keeps the same composer instance when the first message appears", async () => {
    let resolveSend!: (value: { ok: true }) => void;
    const chatId = useChatStore.getState().chatId;
    const send = vi.fn(async (payload: { text: string }, _operation: unknown, onAccepted?: () => void) => {
      useChatStore.setState({
        messages: [
          { id: "u1", role: "user", content: payload.text },
          { id: "a1", role: "assistant", content: "" },
        ],
        status: "streaming",
      });
      onAccepted?.();
      return new Promise<{ ok: true }>((resolve) => { resolveSend = resolve; });
    });
    useChatStore.setState({ send: send as never });

    render(<ChatPanel variant="full" />);
    const input = screen.getByRole("textbox", { name: "Tin nhắn cho trợ lý" });
    fireEvent.click(screen.getByRole("button", { name: "Tìm ghi chú" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Gửi (Enter)" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Gửi (Enter)" }));
    await waitFor(() => expect(send).toHaveBeenCalledTimes(1));
    expect(screen.getByRole("textbox", { name: "Tin nhắn cho trợ lý" })).toBe(input);
    await waitFor(() => expect(input.textContent).toBe(""));
    expect(useComposerStore.getState().drafts[chatId]).toBeUndefined();

    resolveSend({ ok: true });
  });
});
