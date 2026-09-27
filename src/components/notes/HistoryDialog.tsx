import { useEffect, useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { api, type Note, type VersionMeta } from "../../lib/api/notes";
import { fullDateTime, relativeTime } from "../../lib/dates";
import { markdownUrlTransform } from "../../lib/media/attachmentUrl";
import { useNotesStore } from "../../lib/store/notesStore";
import { useUi } from "../../lib/store/uiStore";
import { cn, errMsg } from "../../lib/utils";
import { Overlay } from "../ui/Dialog";
import { PillButton, SecondaryButton } from "../ui/Button";

export const RESTORED_TOAST = "Đã khôi phục — phiên bản hiện tại đã được lưu vào lịch sử";

interface Props {
  noteId: string;
  onClose: () => void;
}

export function HistoryDialog({ noteId, onClose }: Props) {
  const [versions, setVersions] = useState<VersionMeta[] | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [preview, setPreview] = useState<Note | null>(null);
  const [busy, setBusy] = useState(false);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const pushToast = useUi((s) => s.pushToast);

  useEffect(() => {
    let alive = true;
    api.notes
      .listVersions(noteId)
      .then((vs) => {
        if (!alive) return;
        setVersions(vs);
        setSelected(vs[0]?.version ?? null);
      })
      .catch((e) => {
        if (alive) setVersions([]);
        pushToast({ message: errMsg(e), durationMs: 4000 });
      });
    return () => {
      alive = false;
    };
  }, [noteId, pushToast]);

  useEffect(() => {
    setPreviewError(null);
    if (!selected) return setPreview(null);
    let alive = true;
    api.notes
      .readVersion(noteId, selected)
      .then((n) => alive && setPreview(n))
      .catch((e) => {
        if (!alive) return;
        setPreview(null);
        setPreviewError(errMsg(e));
      });
    return () => {
      alive = false;
    };
  }, [noteId, selected]);

  const restore = async () => {
    if (!selected) return;
    setBusy(true);
    try {
      const store = useNotesStore.getState();
      await store.flushSave();
      await api.notes.restoreVersion(noteId, selected);
      await store.reloadBody(noteId);
      await store.load();
      pushToast({ message: RESTORED_TOAST, durationMs: 4000 });
      onClose();
    } catch (e) {
      pushToast({ message: errMsg(e), durationMs: 4000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay open onClose={onClose} label="Lịch sử phiên bản" className="flex h-[560px] w-[860px] flex-col">
      <div className="flex items-center justify-between border-b border-hairline px-5 py-3">
        <h2 className="text-headline font-semibold text-fg">Lịch sử phiên bản</h2>
      </div>
      <div className="flex min-h-0 flex-1">
        <ul className="w-[240px] shrink-0 overflow-y-auto border-r border-hairline p-2" aria-label="Danh sách phiên bản">
          {versions?.length === 0 && (
            <li className="px-2 py-4 text-callout text-fg-secondary">Chưa có phiên bản cũ</li>
          )}
          {versions?.map((v) => (
            <li key={v.version}>
              <button
                type="button"
                title={fullDateTime(v.created)}
                aria-current={v.version === selected}
                onClick={() => setSelected(v.version)}
                className={cn(
                  "w-full rounded-sm px-2.5 py-2 text-left transition-colors hover:bg-hover",
                  v.version === selected && "bg-selected",
                )}
              >
                <div className="text-callout font-medium text-fg">{relativeTime(v.created)}</div>
                <div className="truncate text-footnote text-fg-secondary">
                  {v.title || "Chưa đặt tên"} · {v.words} từ
                </div>
              </button>
            </li>
          ))}
        </ul>
        <div className="min-w-0 flex-1 overflow-y-auto px-6 py-4">
          {previewError && (
            <p role="alert" className="text-callout text-danger">
              Không tải được phiên bản: {previewError}
            </p>
          )}
          {preview && (
            <article className="markdown-body text-body text-fg">
              <h1 className="mb-3 text-title font-semibold">{preview.title || "Chưa đặt tên"}</h1>
              <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={markdownUrlTransform}>
                {preview.body}
              </ReactMarkdown>
            </article>
          )}
        </div>
      </div>
      <div className="flex justify-end gap-2 border-t border-hairline px-5 py-3">
        <SecondaryButton onClick={onClose}>Đóng</SecondaryButton>
        <PillButton tone="accent" className="h-8 px-3.5" disabled={!selected || busy} onClick={() => void restore()}>
          Khôi phục phiên bản này
        </PillButton>
      </div>
    </Overlay>
  );
}
