import { useNotesStore } from "./store/notesStore";
import { useUi } from "./store/uiStore";

/** Extract the note id from an agent note reference (`note://<id>`), else null. */
export function parseNoteHref(href: string): string | null {
  const m = /^note:\/\/([\w-]+)/.exec(href);
  return m?.[1] ?? null;
}

/**
 * Open a note from anywhere (assistant reply links, mentions, deep link):
 * surface the notes workspace, refresh the list when it doesn't know the note
 * (e.g. just created by the agent), then select it. Returns false — with a
 * toast — when the note cannot be opened.
 */
export async function openNoteById(id: string): Promise<boolean> {
  if (!id) return false;
  const ui = useUi.getState();
  const { notes, load } = useNotesStore.getState();
  if (!notes.some((n) => n.id === id)) await load().catch(() => {});
  try {
    await useNotesStore.getState().select(id);
  } catch {
    ui.pushToast({ message: "Không mở được ghi chú — có thể đã bị xóa." });
    return false;
  }
  if (ui.section !== "notes") ui.setSection("notes");
  return true;
}
