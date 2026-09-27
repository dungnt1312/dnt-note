import { render, screen, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

const suggestMock = vi.fn();

vi.mock("../../lib/agent/suggest", () => ({
  suggestTitleAndTags: (...args: unknown[]) => suggestMock(...args),
}));

vi.mock("../../lib/store/settingsStore", () => ({
  useSettingsStore: { getState: () => ({ activeProvider: () => ({ id: "p1" }) }) },
}));

vi.mock("../../lib/store/notesStore", () => ({
  useNotesStore: { getState: () => ({ tags: [] }) },
}));

vi.mock("../../lib/store/uiStore", () => ({
  useUi: Object.assign((selector: (s: Record<string, never>) => unknown) => selector({}), { getState: () => ({}) }),
}));

import { SuggestDialog } from "./SuggestDialog";

describe("SuggestDialog", () => {
  it("shows a friendly Vietnamese message when the AI call fails", async () => {
    suggestMock.mockRejectedValueOnce(new Error("Cannot destructure property 'status'"));
    render(
      <SuggestDialog noteId="n1" title="T" body="B" tags={[]} onClose={() => {}} />,
    );
    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain("Không lấy được gợi ý từ AI");
    });
  });
});
