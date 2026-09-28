import { useEffect, useRef, useState } from "react";
import { Folder, FolderPlus, MoreHorizontal, Pencil, Trash2 } from "lucide-react";
import { useNotesStore } from "../../lib/store/notesStore";
import { useUi } from "../../lib/store/uiStore";
import { useT } from "../../lib/i18n";
import { IconButton } from "../ui/Button";
import { ConfirmDialog } from "../ui/Dialog";
import { Menu, MenuItem, MenuSeparator } from "../ui/Menu";
import { SidebarRow } from "../layout/SidebarRow";

/** Sidebar folders block: header with inline create, rows with note count and a row menu. */
export function FolderSection() {
  const t = useT();
  const folders = useNotesStore((s) => s.folders);
  const notes = useNotesStore((s) => s.notes);
  const createFolder = useNotesStore((s) => s.createFolder);
  const renameFolder = useNotesStore((s) => s.renameFolder);
  const deleteFolder = useNotesStore((s) => s.deleteFolder);
  const folderFilter = useUi((s) => s.folderFilter);
  const setFolderFilter = useUi((s) => s.setFolderFilter);
  const pushToast = useUi((s) => s.pushToast);

  const [creating, setCreating] = useState(false);
  const [draft, setDraft] = useState("");
  const [renaming, setRenaming] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleting, setDeleting] = useState<string | null>(null);
  const cancelledRef = useRef(false);

  // Folder renamed/deleted elsewhere (e.g. sync) → drop the stale filter.
  useEffect(() => {
    if (folderFilter && !folders.some((f) => f.toLowerCase() === folderFilter.toLowerCase())) {
      setFolderFilter(null);
    }
  }, [folders, folderFilter, setFolderFilter]);

  if (folders.length === 0 && !creating) return null;

  const countOf = (name: string) =>
    notes.filter((n) => (n.folder ?? "").toLowerCase() === name.toLowerCase()).length;

  const submitCreate = async () => {
    const name = draft.trim();
    setCreating(false);
    setDraft("");
    if (!name) return;
    if (folders.some((f) => f.toLowerCase() === name.toLowerCase())) {
      pushToast({ message: t("sidebar.folderExists", { name }), durationMs: 5000 });
      return;
    }
    const err = await createFolder(name);
    if (err) pushToast({ message: err, durationMs: 5000 });
    else setFolderFilter(name);
  };

  const submitRename = async (oldName: string) => {
    const newName = renameDraft.trim();
    setRenaming(null);
    setRenameDraft("");
    if (!newName || newName.toLowerCase() === oldName.toLowerCase()) return;
    const res = await renameFolder(oldName, newName);
    if (typeof res === "string") {
      pushToast({ message: res, durationMs: 5000 });
    } else {
      pushToast({ message: t("sidebar.folderRenamed", { n: res }), durationMs: 5000 });
    }
  };

  const confirmDelete = async () => {
    const name = deleting;
    setDeleting(null);
    if (!name) return;
    const res = await deleteFolder(name);
    if (typeof res === "string") {
      pushToast({ message: res, durationMs: 5000 });
    } else {
      pushToast({ message: t("sidebar.folderDeleted", { name, n: res }), durationMs: 5000 });
    }
  };

  return (
    <section aria-label={t("sidebar.folders")} className="px-2">
      <div className="flex items-center justify-between pb-1 pl-0.5 pr-0.5 pt-3.5">
        <span className="text-footnote font-semibold text-fg-secondary">{t("sidebar.folders")}</span>
        <IconButton
          size="sm"
          label={t("sidebar.newFolder")}
          onClick={() => {
            setDraft("");
            cancelledRef.current = false;
            setCreating(true);
          }}
        >
          <FolderPlus size={14} strokeWidth={1.75} aria-hidden="true" />
        </IconButton>
      </div>
      <ul className="flex flex-col gap-px">
        {creating && (
          <li>
            <input
              autoFocus
              value={draft}
              aria-label={t("sidebar.folderName")}
              placeholder={t("sidebar.folderName")}
              onChange={(e) => setDraft(e.target.value)}
              onBlur={() => {
                if (!cancelledRef.current) void submitCreate();
              }}
              onKeyDown={(e) => {
                if (e.key === "Enter") e.currentTarget.blur();
                if (e.key === "Escape") {
                  e.stopPropagation();
                  cancelledRef.current = true;
                  setCreating(false);
                  setDraft("");
                }
              }}
              className="h-[30px] w-full rounded-sm border border-fg-tertiary bg-control px-2.5 text-callout text-fg outline-none"
            />
          </li>
        )}
        {folders.map((name) => {
          const active = folderFilter?.toLowerCase() === name.toLowerCase();
          if (renaming === name) {
            return (
              <li key={name}>
                <input
                  autoFocus
                  value={renameDraft}
                  aria-label={t("sidebar.renameFolder")}
                  onChange={(e) => setRenameDraft(e.target.value)}
                  onBlur={() => void submitRename(name)}
                  onKeyDown={(e) => {
                    if (e.key === "Enter") e.currentTarget.blur();
                    if (e.key === "Escape") {
                      e.stopPropagation();
                      setRenaming(null);
                      setRenameDraft("");
                    }
                  }}
                  className="h-[30px] w-full rounded-sm border border-fg-tertiary bg-control px-2.5 text-callout text-fg outline-none"
                />
              </li>
            );
          }
          return (
            <li key={name}>
              <SidebarRow
                selected={active}
                label={t("sidebar.folderRowLabel", { name, n: countOf(name) })}
                onSelect={() => setFolderFilter(active ? null : name)}
                actions={
                  <Menu
                    width={190}
                    trigger={(p) => (
                      <button
                        type="button"
                        {...p}
                        aria-label={t("sidebar.optionsFor", { title: name })}
                        title={t("sidebar.options")}
                        className="flex size-7 items-center justify-center rounded-sm text-fg-secondary hover:bg-selected hover:text-fg"
                      >
                        <MoreHorizontal size={15} aria-hidden="true" />
                      </button>
                    )}
                  >
                    <MenuItem
                      icon={<Pencil size={14} />}
                      onSelect={() => {
                        setRenameDraft(name);
                        setRenaming(name);
                      }}
                    >
                      {t("sidebar.renameFolder")}
                    </MenuItem>
                    <MenuSeparator />
                    <MenuItem destructive icon={<Trash2 size={14} />} onSelect={() => setDeleting(name)}>
                      {t("sidebar.deleteFolder")}
                    </MenuItem>
                  </Menu>
                }
              >
                <span className="flex items-center gap-2 py-0.5">
                  <Folder
                    size={14}
                    aria-hidden="true"
                    className={active ? "fill-current text-fg" : "text-fg-secondary"}
                  />
                  <span className="min-w-0 flex-1 truncate text-callout text-fg">{name}</span>
                  <span className="text-footnote tabular-nums text-fg-tertiary">{countOf(name)}</span>
                </span>
              </SidebarRow>
            </li>
          );
        })}
      </ul>
      <ConfirmDialog
        open={deleting !== null}
        title={t("sidebar.deleteFolderTitle", { name: deleting ?? "" })}
        description={t("sidebar.deleteFolderDesc")}
        confirmLabel={t("sidebar.delete")}
        onCancel={() => setDeleting(null)}
        onConfirm={() => void confirmDelete()}
      />
    </section>
  );
}
