import { useT } from "../../lib/i18n";
import { useNotesStore } from "../../lib/store/notesStore";
import { useUi } from "../../lib/store/uiStore";

/** Delete → trash with an "Undo" toast (also Ctrl+Z). Shared by sidebar, editor and palette. */
export function useDeleteNote() {
  const t = useT();
  const del = useNotesStore((s) => s.del);
  const undoDelete = useNotesStore((s) => s.undoDelete);
  const pushToast = useUi((s) => s.pushToast);

  return (id: string) => {
    const title = useNotesStore.getState().notes.find((n) => n.id === id)?.title ?? t("notes.fallbackNoteLower");
    void del(id);
    pushToast({
      message: t("notes.deletedToast", { title }),
      actionLabel: t("notes.undo"),
      onAction: () => void undoDelete(),
    });
  };
}
