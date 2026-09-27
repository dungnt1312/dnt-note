import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
const openDialog = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...a: unknown[]) => openDialog(...a) }));

import { Composer } from "./Composer";
import { useChatStore } from "../../../lib/store/chatStore";
import { useComposerStore } from "../../../lib/store/composerStore";
import { useNotesStore } from "../../../lib/store/notesStore";

const fakeFile = (bytes: number[], name: string, type = "image/png"): File =>
  ({ name, size: bytes.length, type, arrayBuffer: async () => new Uint8Array(bytes).buffer }) as unknown as File;

beforeEach(() => {
  invoke.mockReset();
  openDialog.mockReset();
  useNotesStore.setState({ notes: [], selectedId: null, tags: [] });
  useComposerStore.setState({ drafts: {} });
  useChatStore.setState({ status: "idle", error: null });
});

describe("Composer", () => {
  it("send disabled with an empty draft, enabled once a ready attachment exists", async () => {
    invoke
      .mockImplementationOnce(() => Promise.resolve({ name: "uuid-a.png", size: 3, path: "C:/a.png" }))
      .mockImplementationOnce(() => Promise.resolve("data:image/png;base64,AA"));
    render(<Composer placeholder="Hỏi…" />);
    expect(screen.getByRole("button", { name: "Gửi (Enter)" })).toBeDisabled();

    openDialog.mockResolvedValue(["C:/pic.png"]);
    fireEvent.click(screen.getByRole("button", { name: "Đính kèm file" }));
    await waitFor(() =>
      expect(screen.getByRole("button", { name: "Gửi (Enter)" })).toBeEnabled(),
    );
    expect(screen.getByRole("listitem", { name: "pic.png" })).toBeTruthy();
    expect(screen.getByAltText("")).toHaveAttribute("src", "data:image/png;base64,AA");
  });

  it("sends the payload with attachment and clears the draft on ok", async () => {
    invoke
      .mockImplementationOnce(() => Promise.resolve({ name: "uuid-a.png", size: 3, path: "C:/a.png" }))
      .mockImplementationOnce(() => Promise.resolve("data:image/png;base64,AA"));
    const spy = vi.fn().mockResolvedValue({ ok: true });
    useChatStore.setState({ send: spy as never });
    render(<Composer placeholder="Hỏi…" />);
    const chatId = useChatStore.getState().chatId;
    await useComposerStore.getState().addAttachmentFiles(chatId, [fakeFile([1, 2, 3], "a.png")]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Gửi (Enter)" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Gửi (Enter)" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const payload = spy.mock.calls[0]![0] as { text: string; mentions: unknown[]; attachments: { name: string }[] };
    expect(payload.attachments[0]!.name).toBe("uuid-a.png");
    expect(useComposerStore.getState().drafts[chatId]).toBeUndefined();
  });

  it("keeps the draft when send is rejected", async () => {
    invoke
      .mockImplementationOnce(() => Promise.resolve({ name: "u.png", size: 1, path: "C:/u.png" }))
      .mockImplementationOnce(() => Promise.resolve("data:image/png;base64,AA"));
    const spy = vi.fn().mockResolvedValue({ ok: false, error: "Chưa cấu hình provider AI" });
    useChatStore.setState({ send: spy as never, error: "Chưa cấu hình provider AI" });
    render(<Composer placeholder="Hỏi…" />);
    const chatId = useChatStore.getState().chatId;
    await useComposerStore.getState().addAttachmentFiles(chatId, [fakeFile([1], "u.png")]);
    await waitFor(() => expect(screen.getByRole("button", { name: "Gửi (Enter)" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Gửi (Enter)" }));
    await waitFor(() => expect(spy).toHaveBeenCalled());
    expect(useComposerStore.getState().drafts[chatId]).toBeDefined();
  });

  it("removes an attachment from the tray", async () => {
    invoke
      .mockImplementationOnce(() => Promise.resolve({ name: "u.png", size: 1, path: "C:/u.png" }))
      .mockImplementationOnce(() => Promise.resolve("data:image/png;base64,AA"));
    render(<Composer placeholder="Hỏi…" />);
    const chatId = useChatStore.getState().chatId;
    await useComposerStore.getState().addAttachmentFiles(chatId, [fakeFile([1], "u.png")]);
    await waitFor(() => expect(screen.getByRole("listitem", { name: "u.png" })).toBeTruthy());
    fireEvent.click(screen.getByRole("button", { name: "Bỏ u.png" }));
    await waitFor(() => expect(screen.queryByRole("listitem", { name: "u.png" })).toBeNull());
  });

  it("shows a stop button while streaming", () => {
    useChatStore.setState({ status: "streaming" });
    render(<Composer placeholder="Hỏi…" />);
    expect(screen.getByRole("button", { name: "Dừng tạo câu trả lời" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Gửi (Enter)" })).toBeNull();
  });
});
