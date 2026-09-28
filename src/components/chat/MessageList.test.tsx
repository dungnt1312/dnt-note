import { describe, it, expect, vi, beforeEach } from "vitest";
import { fireEvent, render, screen } from "@testing-library/react";

vi.mock("../../lib/openNote", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/openNote")>()),
  openNoteById: vi.fn(async () => true),
}));

import { openNoteById } from "../../lib/openNote";
import { MessageList } from "./MessageList";
import { useChatStore } from "../../lib/store/chatStore";

const openNoteMock = vi.mocked(openNoteById);

describe("MessageList note references", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders a note:// link as a chip that opens the note", () => {
    render(
      <MessageList
        messages={[{ id: "m1", role: "assistant", content: "Tôi tìm thấy [Ghi A](note://n1) nhé." }]}
        streaming={false}
      />,
    );

    const chip = screen.getByRole("button", { name: /Ghi A/ });
    fireEvent.click(chip);
    expect(openNoteMock).toHaveBeenCalledWith("n1");
  });

  it("leaves normal links as anchors", () => {
    render(
      <MessageList
        messages={[{ id: "m1", role: "assistant", content: "Xem [tài liệu](https://example.com)." }]}
        streaming={false}
      />,
    );

    expect(screen.getByRole("link", { name: "tài liệu" })).toHaveAttribute("href", "https://example.com");
    expect(openNoteMock).not.toHaveBeenCalled();
  });

  it("opens a note when a user-message mention chip is clicked", () => {
    render(
      <MessageList
        messages={[
          {
            id: "m1",
            role: "user",
            content: "tóm tắt giúp tôi",
            mentions: [{ id: "n2", title: "Ghi B" }],
          },
        ]}
        streaming={false}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Ghi B" }));
    expect(openNoteMock).toHaveBeenCalledWith("n2");
  });

  it("does not make failed mentions clickable", () => {
    render(
      <MessageList
        messages={[
          {
            id: "m1",
            role: "user",
            content: "tóm tắt giúp tôi",
            mentions: [{ id: "n3", title: "Ghi C", failed: true }],
          },
        ]}
        streaming={false}
      />,
    );

    expect(screen.getByText(/Ghi C \(không đọc được\)/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /Ghi C/ })).toBeNull();
  });

  it("renders a separate confirmation for each requested deletion", () => {
    useChatStore.setState({
      messages: [{
        id: "a1", role: "assistant", content: "Xác nhận xóa",
        pendingDeletes: [
          { id: "n1", title: "Một", status: "pending" },
          { id: "n2", title: "Hai", status: "pending" },
        ],
      }],
    });
    render(<MessageList messages={useChatStore.getState().messages} streaming={false} />);

    expect(screen.getAllByRole("alertdialog")).toHaveLength(2);
    expect(screen.getByText("Một")).toBeInTheDocument();
    expect(screen.getByText("Hai")).toBeInTheDocument();
  });
});
