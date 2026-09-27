import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";

vi.mock("../../lib/api/notes", () => ({
  api: {
    notes: {
      listVersions: vi.fn(async () => [
        { version: "20260927T143005123Z", created: "2026-09-27T14:30:05.123Z", title: "Bản mới", words: 12 },
        { version: "20260926T100000000Z", created: "2026-09-26T10:00:00Z", title: "Bản cũ", words: 3 },
      ]),
      readVersion: vi.fn(async () => {
        throw "hỏng";
      }),
    },
  },
}));

import { HistoryDialog } from "./HistoryDialog";
import { api } from "../../lib/api/notes";

describe("HistoryDialog", () => {
  it("lists versions newest first and shows preview errors inline", async () => {
    render(<HistoryDialog noteId="n1" onClose={vi.fn()} />);
    expect(await screen.findByText(/Bản mới · 12 từ/)).toBeInTheDocument();
    expect(screen.getByText(/Bản cũ · 3 từ/)).toBeInTheDocument();
    expect(await screen.findByRole("alert")).toHaveTextContent("Không tải được phiên bản");
  });

  it("shows empty state", async () => {
    vi.mocked(api.notes.listVersions).mockResolvedValueOnce([]);
    render(<HistoryDialog noteId="n1" onClose={vi.fn()} />);
    expect(await screen.findByText("Chưa có phiên bản cũ")).toBeInTheDocument();
  });
});
