import { useEffect, useState } from "react";
import { ExternalLink, FilePlus, Pencil, Trash2 } from "lucide-react";
import type { MediaItem } from "../../lib/api/media";
import { mediaApi } from "../../lib/api/media";
import { attachmentUrl } from "../../lib/media/attachmentUrl";
import { isTauri } from "../../lib/env";
import { errMsg } from "../../lib/utils";
import { useMediaStore } from "../../lib/store/mediaStore";
import { useNotesStore } from "../../lib/store/notesStore";
import { useUi } from "../../lib/store/uiStore";
import { SecondaryButton } from "../ui/Button";
import { ConfirmDialog } from "../ui/Dialog";
import { SidebarRow } from "../layout/SidebarRow";
import { MediaIcon } from "./MediaGrid";
import { formatSize } from "./format";

export function mediaLink(item: MediaItem): string {
  const link = `[${item.displayName}](attachments/${encodeURI(item.name)})`;
  return item.kind === "image" ? `!${link}` : link;
}

export function MediaDetail({ item }: { item: MediaItem }) {
  const rename = useMediaStore((s) => s.rename);
  const remove = useMediaStore((s) => s.remove);
  const selectedNote = useNotesStore((s) => s.selectedId);
  const setSection = useUi((s) => s.setSection);
  const pushToast = useUi((s) => s.pushToast);
  const [renaming, setRenaming] = useState(false);
  const [draft, setDraft] = useState(item.displayName);
  const [confirming, setConfirming] = useState(false);

  useEffect(() => {
    setRenaming(false);
    setDraft(item.displayName);
  }, [item.name, item.displayName]);

  const src = attachmentUrl(item.name);
  const used = item.usedBy.length;

  const commitRename = async () => {
    setRenaming(false);
    const next = draft.trim();
    if (!next || next === item.displayName) return;
    try {
      await rename(item.name, next);
    } catch (e) {
      pushToast({ message: errMsg(e), durationMs: 5000 });
    }
  };

  const insert = async () => {
    const notes = useNotesStore.getState();
    if (!notes.selectedId) return;
    const body = notes.body ?? "";
    const sep = body === "" || body.endsWith("\n\n") ? "" : body.endsWith("\n") ? "\n" : "\n\n";
    notes.setBody(`${body}${sep}${mediaLink(item)}\n`);
    try {
      await useNotesStore.getState().flushSave();
      pushToast({ message: "Đã chèn vào ghi chú", durationMs: 3000 });
    } catch (e) {
      pushToast({ message: `Không lưu được ghi chú: ${errMsg(e)}`, durationMs: 6000 });
    }
    void useMediaStore.getState().load().catch(() => {});
  };

  const openExternal = async () => {
    try {
      const [{ openPath }, { join }] = await Promise.all([
        import("@tauri-apps/plugin-opener"),
        import("@tauri-apps/api/path"),
      ]);
      await openPath(await join(await mediaApi.dirPath(), item.name));
    } catch (e) {
      pushToast({ message: errMsg(e), durationMs: 5000 });
    }
  };

  const doDelete = async () => {
    setConfirming(false);
    try {
      await remove(item.name, used > 0);
      pushToast({ message: `Đã xoá ${item.displayName}`, durationMs: 3000 });
    } catch (e) {
      pushToast({ message: errMsg(e), durationMs: 6000 });
    }
  };

  return (
    <aside aria-label="Chi tiết tệp" className="flex w-[300px] shrink-0 flex-col overflow-y-auto border-l border-hairline p-4">
      <div className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden rounded-[10px] bg-subtle">
        {item.kind === "image" && src ? (
          <img src={src} alt={item.displayName} className="max-h-full max-w-full object-contain" />
        ) : (
          <MediaIcon item={item} size={40} />
        )}
      </div>
      {item.kind === "audio" && src && <audio controls src={src} className="mt-3 w-full" />}

      {renaming ? (
        <input
          autoFocus
          value={draft}
          aria-label="Tên tệp"
          onChange={(e) => setDraft(e.target.value)}
          onBlur={() => void commitRename()}
          onKeyDown={(e) => {
            if (e.key === "Enter") e.currentTarget.blur();
            if (e.key === "Escape") {
              // Keep App's window-level Escape handler from leaving the section.
              e.preventDefault();
              e.stopPropagation();
              setDraft(item.displayName);
              setRenaming(false);
            }
          }}
          className="mt-3 h-8 w-full rounded-sm border border-fg-tertiary bg-control px-2.5 text-callout text-fg outline-none"
        />
      ) : (
        <h2 className="mt-3 break-all text-callout font-semibold text-fg">{item.displayName}</h2>
      )}
      <p className="mt-1 text-footnote text-fg-secondary">
        {item.ext.toUpperCase()} · {formatSize(item.size)} · {new Date(item.modified).toLocaleString("vi-VN")}
      </p>

      <div className="mt-4 flex flex-wrap gap-2">
        <SecondaryButton disabled={!isTauri} onClick={() => setRenaming(true)}>
          <Pencil size={13} aria-hidden="true" /> Đổi tên
        </SecondaryButton>
        <SecondaryButton
          disabled={!isTauri || !selectedNote}
          title={selectedNote ? undefined : "Chưa mở ghi chú nào"}
          onClick={() => void insert()}
        >
          <FilePlus size={13} aria-hidden="true" /> Chèn vào ghi chú đang mở
        </SecondaryButton>
        <SecondaryButton disabled={!isTauri} onClick={() => void openExternal()}>
          <ExternalLink size={13} aria-hidden="true" /> Mở bằng ứng dụng khác
        </SecondaryButton>
        <SecondaryButton destructive disabled={!isTauri} onClick={() => setConfirming(true)}>
          <Trash2 size={13} aria-hidden="true" /> Xoá
        </SecondaryButton>
      </div>

      <h3 className="mt-5 text-footnote font-medium text-fg-secondary">Dùng trong</h3>
      {used === 0 ? (
        <p className="mt-1 text-footnote text-fg-tertiary">Chưa dùng trong ghi chú nào</p>
      ) : (
        <ul className="mt-1 flex flex-col gap-px">
          {item.usedBy.map((n) => (
            <li key={n.id}>
              <SidebarRow
                selected={false}
                onSelect={() => {
                  setSection("notes");
                  void useNotesStore.getState().select(n.id);
                }}
              >
                <span className="block truncate text-callout text-fg">{n.title || "Không tiêu đề"}</span>
              </SidebarRow>
            </li>
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={confirming}
        title={`Xoá “${item.displayName}”?`}
        description={
          used > 0
            ? `Tệp đang được dùng — liên kết sẽ bị gỡ khỏi ${used} ghi chú.`
            : "Tệp sẽ bị xoá vĩnh viễn khỏi thư viện."
        }
        confirmLabel={used > 0 ? `Xoá và gỡ khỏi ${used} ghi chú` : "Xoá"}
        onCancel={() => setConfirming(false)}
        onConfirm={() => void doDelete()}
      />
    </aside>
  );
}
