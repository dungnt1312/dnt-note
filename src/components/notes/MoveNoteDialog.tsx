import { Check, Folder } from "lucide-react";
import type { NoteMeta } from "../../lib/api/notes";
import { useNotesStore } from "../../lib/store/notesStore";
import { useUi } from "../../lib/store/uiStore";
import { useT } from "../../lib/i18n";
import { Overlay } from "../ui/Dialog";

interface MoveNoteDialogProps {
  note: NoteMeta | null;
  onClose: () => void;
}

/** Modal list of folders (+ "no folder") — picking one moves the note, with an Undo toast. */
export function MoveNoteDialog({ note, onClose }: MoveNoteDialogProps) {
  const t = useT();
  const folders = useNotesStore((s) => s.folders);
  const moveNoteToFolder = useNotesStore((s) => s.moveNoteToFolder);
  const pushToast = useUi((s) => s.pushToast);

  if (!note) return null;

  const pick = async (folder: string | null) => {
    const target = note.id;
    onClose();
    const prev = await moveNoteToFolder(target, folder);
    if (prev === "error") {
      pushToast({ message: t("sidebar.moveFailed"), durationMs: 5000 });
      return;
    }
    if (prev === folder) return;
    const label = folder ?? t("sidebar.noFolder");
    pushToast({
      message: t("sidebar.movedToFolder", { name: label }),
      actionLabel: t("notes.undo"),
      durationMs: 8000,
      onAction: () => void moveNoteToFolder(target, prev),
    });
  };

  const options: { name: string | null; label: string }[] = [
    { name: null, label: t("sidebar.noFolder") },
    ...folders.map((f) => ({ name: f, label: f })),
  ];
  const selected = (name: string | null) =>
    name === null ? note.folder === null : (note.folder ?? "").toLowerCase() === name.toLowerCase();

  return (
    <Overlay
      open
      onClose={onClose}
      label={t("sidebar.moveToFolderTitle", { title: note.title })}
      className="w-[320px]"
    >
      <div
        className="max-h-[60vh] overflow-y-auto p-2"
        role="listbox"
        aria-label={t("sidebar.moveToFolder")}
      >
        <p className="px-2.5 pb-1.5 pt-1.5 text-footnote font-semibold text-fg-secondary">
          {t("sidebar.moveToFolderTitle", { title: note.title })}
        </p>
        {options.map(({ name, label }) => (
          <button
            key={name ?? "__root"}
            type="button"
            role="option"
            aria-selected={selected(name)}
            onClick={() => void pick(name)}
            className="flex w-full items-center gap-2.5 rounded-sm px-2.5 py-2 text-left text-callout text-fg transition-colors hover:bg-hover"
          >
            <Folder size={15} aria-hidden="true" className="shrink-0 text-fg-secondary" />
            <span className="min-w-0 flex-1 truncate">{label}</span>
            {selected(name) && <Check size={15} aria-hidden="true" className="shrink-0 text-fg" />}
          </button>
        ))}
      </div>
    </Overlay>
  );
}
