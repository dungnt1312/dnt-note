import { useRef } from "react";
import type { EditorView } from "@codemirror/view";
import { Mic, Square } from "lucide-react";
import { mediaApi } from "../../lib/api/media";
import { bytesToBase64, countAttachmentRefs, markdownLinkFor, MAX_FILES_PER_NOTE } from "../../lib/media/insertLink";
import { formatElapsed, formatTranscript, voiceFileName, voiceLinkFor } from "../../lib/media/voice";
import { useRecorder } from "../../lib/media/useRecorder";
import { getTracked, setTracked, untrack } from "../../lib/editor/trackedPos";
import { transcribe } from "../../lib/llm/openai";
import { useSettingsStore } from "../../lib/store/settingsStore";
import { useNotesStore } from "../../lib/store/notesStore";
import { useUi } from "../../lib/store/uiStore";
import { isTauri } from "../../lib/env";
import { errMsg } from "../../lib/utils";

let hintShown = false;
let trackSeq = 1_000_000;

/** Insert `text` on its own line at `pos` (clamped); returns the end position. */
function insertLine(v: EditorView, pos: number, text: string): number {
  const at = Math.min(Math.max(0, pos), v.state.doc.length);
  const before = at > 0 ? v.state.doc.sliceString(at - 1, at) : "\n";
  const insert = (before === "\n" ? "" : "\n") + text;
  v.dispatch({ changes: { from: at, insert } });
  return at + insert.length;
}

/** Mic button: records audio, attaches it, then optionally inserts a transcript. */
export function VoiceRecorder({ view, noteId }: { view: EditorView | null; noteId: string | null }) {
  const pushToast = useUi((s) => s.pushToast);
  const session = useRef<{ v: EditorView; noteId: string; trackId: number } | null>(null);

  const release = (s: { v: EditorView; trackId: number }) => {
    if (s.v.dom.isConnected) s.v.dispatch({ effects: untrack.of(s.trackId) });
  };

  const handleBlob = async (blob: Blob) => {
    const s = session.current;
    session.current = null;
    if (!s) return;
    const { v } = s;
    const alive = () => v.dom.isConnected && useNotesStore.getState().selectedId === s.noteId;
    try {
      const fileName = voiceFileName();
      const b64 = bytesToBase64(new Uint8Array(await blob.arrayBuffer()));
      const stored = await mediaApi.importBytes(fileName, b64);
      if (!alive()) {
        pushToast({ message: "Ghi chú đã đổi — bản ghi âm đã lưu vào thư viện media", durationMs: 6000 });
        return;
      }
      if (countAttachmentRefs(v.state.doc.toString()) >= MAX_FILES_PER_NOTE) {
        pushToast({
          message: `Tối đa ${MAX_FILES_PER_NOTE} file đính kèm mỗi ghi chú — bản ghi âm chỉ lưu trong thư viện media`,
          durationMs: 6000,
        });
        return;
      }
      const at = getTracked(v.state, s.trackId) ?? v.state.selection.main.head;
      const end = insertLine(v, at, voiceLinkFor(markdownLinkFor(stored.name)));
      v.dispatch({ effects: setTracked.of({ id: s.trackId, pos: end }) });

      const provider = useSettingsStore.getState().activeProvider();
      const model = provider?.transcriptionModel?.trim();
      if (!provider || !model) {
        if (!hintShown) {
          hintShown = true;
          pushToast({ message: "Thêm model chuyển giọng nói trong Cài đặt để tự tạo bản ghi chữ", durationMs: 6000 });
        }
        return;
      }
      pushToast({ message: "Đang chuyển giọng nói thành chữ…", durationMs: 60000 });
      const text = await transcribe({
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model,
        audio: blob,
        fileName,
      });
      const quote = formatTranscript(text);
      // Every branch below replaces the progress toast with a result toast.
      if (!alive()) {
        pushToast({ message: "Ghi chú đã đổi — bản ghi chữ chưa được chèn", durationMs: 6000 });
        return;
      }
      if (!quote) {
        pushToast({ message: "Không nhận được nội dung giọng nói", durationMs: 4000 });
        return;
      }
      const pos = getTracked(v.state, s.trackId) ?? v.state.doc.length;
      insertLine(v, pos, quote);
      pushToast({ message: "Đã chèn bản ghi chữ", durationMs: 3000 });
    } catch (e) {
      // Also replaces a pending "Đang chuyển…" toast (single-toast store).
      pushToast({ message: `Không lưu/chuyển được ghi âm: ${errMsg(e)}`, durationMs: 6000 });
    } finally {
      release(s);
    }
  };

  const { recording, elapsedMs, start, stop } = useRecorder({
    onBlob: (b) => void handleBlob(b),
    onError: (e) => {
      const s = session.current;
      session.current = null;
      if (s) release(s);
      pushToast({ message: `Không truy cập được micro: ${errMsg(e)}`, durationMs: 6000 });
    },
    onCancel: () => {
      const s = session.current;
      session.current = null;
      if (s) release(s);
      pushToast({ message: "Đã dừng ghi âm — bản ghi bị hủy", durationMs: 5000 });
    },
  });

  const begin = () => {
    if (!view || !noteId || !isTauri || session.current) return;
    if (countAttachmentRefs(view.state.doc.toString()) >= MAX_FILES_PER_NOTE) {
      pushToast({ message: `Tối đa ${MAX_FILES_PER_NOTE} file đính kèm mỗi ghi chú`, durationMs: 5000 });
      return;
    }
    const trackId = ++trackSeq;
    view.dispatch({ effects: setTracked.of({ id: trackId, pos: view.state.selection.main.head }) });
    session.current = { v: view, noteId, trackId };
    void start();
  };

  if (recording) {
    return (
      <button
        type="button"
        aria-label="Dừng ghi âm"
        title="Dừng ghi âm"
        onMouseDown={(e) => e.preventDefault()}
        onClick={stop}
        className="flex h-7 items-center gap-1.5 rounded-[7px] px-2 text-footnote tabular-nums text-fg hover:bg-hover"
      >
        <span aria-hidden="true" className="h-2 w-2 animate-pulse rounded-full bg-red-500" />
        <span aria-live="off">{formatElapsed(elapsedMs)}</span>
        <Square size={12} aria-hidden="true" className="fill-current" />
      </button>
    );
  }
  return (
    <button
      type="button"
      aria-label="Ghi âm giọng nói"
      title="Ghi âm giọng nói"
      disabled={!view || !isTauri}
      onMouseDown={(e) => e.preventDefault()}
      onClick={begin}
      className="flex h-7 min-w-[30px] items-center justify-center rounded-[7px] px-1.5 text-fg-secondary transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
    >
      <Mic size={15} aria-hidden="true" />
    </button>
  );
}
