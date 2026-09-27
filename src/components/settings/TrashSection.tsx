import { useCallback, useEffect, useState } from "react";
import { RotateCcw, Trash2 } from "lucide-react";
import { api, type NoteMeta } from "../../lib/api/notes";
import { fullDateTime, relativeTime } from "../../lib/dates";
import { isTauri } from "../../lib/env";
import { useNotesStore } from "../../lib/store/notesStore";
import { useUi } from "../../lib/store/uiStore";
import { errMsg } from "../../lib/utils";
import { SecondaryButton } from "../ui/Button";
import { ConfirmDialog } from "../ui/Dialog";

export function TrashSection() {
  const pushToast = useUi((s) => s.pushToast);
  const [items, setItems] = useState<NoteMeta[] | null>(null);
  const [purgeId, setPurgeId] = useState<string | null>(null);
  const [confirmAll, setConfirmAll] = useState(false);

  const refresh = useCallback(() => {
    if (!isTauri) return setItems([]);
    api.notes
      .listTrash()
      .then(setItems)
      .catch((e) => {
        setItems([]);
        pushToast({ message: errMsg(e), durationMs: 4000 });
      });
  }, [pushToast]);

  useEffect(refresh, [refresh]);

  const restore = async (id: string) => {
    try {
      await api.notes.restore(id);
      await useNotesStore.getState().load();
      pushToast({ message: "Đã khôi phục ghi chú", durationMs: 3000 });
    } catch (e) {
      pushToast({ message: `Không khôi phục được: ${errMsg(e)}`, durationMs: 5000 });
    }
    refresh();
  };

  const purge = async (id: string) => {
    try {
      await api.notes.purgeTrashItem(id);
      pushToast({ message: "Đã xóa vĩnh viễn", durationMs: 3000 });
    } catch (e) {
      pushToast({ message: `Không xóa được: ${errMsg(e)}`, durationMs: 5000 });
    }
    refresh();
  };

  const purgeTitle = items?.find((i) => i.id === purgeId)?.title;

  return (
    <div className="overflow-hidden rounded-md border border-hairline bg-control">
      <div className="flex min-h-10 items-center gap-4 px-4 py-2.5">
        <div className="min-w-0 flex-1">
          <div className="text-callout text-fg">Thùng rác</div>
          <div className="text-footnote text-fg-secondary">Ghi chú đã xóa được giữ lại để có thể khôi phục.</div>
        </div>
        <SecondaryButton destructive onClick={() => setConfirmAll(true)} disabled={!isTauri || items?.length === 0}>
          <Trash2 size={14} aria-hidden="true" /> Dọn sạch…
        </SecondaryButton>
      </div>
      <ul aria-label="Ghi chú trong thùng rác" className="max-h-[320px] divide-y divide-hairline overflow-y-auto border-t border-hairline">
        {items?.length === 0 && <li className="px-4 py-3 text-callout text-fg-secondary">Thùng rác trống</li>}
        {items?.map((n) => (
          <li key={n.id} className="flex items-center gap-3 px-4 py-2">
            <div className="min-w-0 flex-1">
              <div className="truncate text-callout text-fg">{n.title || "Chưa đặt tên"}</div>
              <div className="text-footnote text-fg-secondary" title={fullDateTime(n.updated)}>
                Đã xóa {relativeTime(n.updated)}
              </div>
            </div>
            <SecondaryButton onClick={() => void restore(n.id)}>
              <RotateCcw size={14} aria-hidden="true" /> Khôi phục
            </SecondaryButton>
            <SecondaryButton destructive onClick={() => setPurgeId(n.id)}>
              Xóa vĩnh viễn
            </SecondaryButton>
          </li>
        ))}
      </ul>
      <ConfirmDialog
        open={purgeId !== null}
        title="Xóa vĩnh viễn ghi chú?"
        description={`“${purgeTitle || "Chưa đặt tên"}” và lịch sử phiên bản của nó sẽ bị xóa và không thể khôi phục.`}
        confirmLabel="Xóa vĩnh viễn"
        onCancel={() => setPurgeId(null)}
        onConfirm={() => {
          const id = purgeId;
          setPurgeId(null);
          if (id) void purge(id);
        }}
      />
      <ConfirmDialog
        open={confirmAll}
        title="Dọn sạch thùng rác?"
        description="Mọi ghi chú trong thùng rác sẽ bị xóa vĩnh viễn và không thể khôi phục."
        confirmLabel="Xóa vĩnh viễn"
        onCancel={() => setConfirmAll(false)}
        onConfirm={() => {
          setConfirmAll(false);
          void api.notes
            .emptyTrash()
            .then((n) => pushToast({ message: `Đã xóa vĩnh viễn ${n} ghi chú`, durationMs: 4000 }))
            .catch((e) => pushToast({ message: `Không dọn được thùng rác: ${e}`, durationMs: 6000 }))
            .finally(refresh);
        }}
      />
    </div>
  );
}
