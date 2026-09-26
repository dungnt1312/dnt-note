import { useState } from "react";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { Check, ChevronRight, Copy, AlertTriangle, Trash2 } from "lucide-react";
import type { UiMessage } from "../../lib/store/chatStore";
import { useChatStore } from "../../lib/store/chatStore";
import { cn } from "../../lib/utils";

function Markdown({ text }: { text: string }) {
  return (
    <div className="chat-md text-[13.5px] leading-relaxed text-[var(--text)] [&_a]:text-[var(--accent)] [&_code]:bg-[var(--code-bg)] [&_code]:px-1 [&_code]:rounded [&_code]:text-[12.5px] [&_pre]:bg-[var(--code-bg)] [&_pre]:p-3 [&_pre]:rounded-[var(--radius-md)] [&_pre]:overflow-x-auto [&_table]:border-collapse [&_td]:border [&_td]:border-[var(--border)] [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-[var(--border)] [&_th]:px-2 [&_th]:py-1 [&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5 [&_blockquote]:border-l-2 [&_blockquote]:border-[var(--border)] [&_blockquote]:pl-3 [&_blockquote]:text-[var(--text-secondary)]">
      <ReactMarkdown remarkPlugins={[remarkGfm]}>{text}</ReactMarkdown>
    </div>
  );
}

function ToolCallCard({ call }: { call: NonNullable<UiMessage["toolCalls"]>[number] }) {
  const [open, setOpen] = useState(false);
  const short = call.result ? (call.result.length > 120 ? `${call.result.slice(0, 120)}…` : call.result) : "…";
  return (
    <div className="my-1 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-elevated)] text-[12px] overflow-hidden">
      <button
        onClick={() => setOpen((o) => !o)}
        className="w-full flex items-center gap-2 px-2.5 py-1.5 hover:bg-[var(--bg-hover)] text-left"
      >
        <ChevronRight size={12} className={cn("transition-transform text-[var(--text-faint)]", open && "rotate-90")} />
        <span className="font-mono text-[var(--accent)]">{call.name}</span>
        <span className="font-mono text-[var(--text-faint)] truncate flex-1">{call.args}</span>
        <span className={cn("text-[10px]", call.status === "running" ? "text-[var(--text-faint)] animate-pulse" : "text-[var(--text-secondary)]")}>
          {call.status === "running" ? "chạy…" : "xong"}
        </span>
      </button>
      {open && (
        <pre className="px-3 py-2 border-t border-[var(--border)] bg-[var(--bg-panel)] whitespace-pre-wrap break-all max-h-[200px] overflow-y-auto text-[11px] text-[var(--text-secondary)]">
          {call.result ?? short}
        </pre>
      )}
      {!open && (
        <div className="px-3 pb-1.5 text-[11px] text-[var(--text-faint)] truncate">{short}</div>
      )}
    </div>
  );
}

function DeleteConfirmCard({ pending }: { pending: NonNullable<UiMessage["pendingDelete"]> }) {
  const confirmDelete = useChatStore((s) => s.confirmDelete);
  const cancelDelete = useChatStore((s) => s.cancelDelete);

  if (pending.status !== "pending") {
    return (
      <div className="my-1 flex items-center gap-2 px-3 py-2 rounded-[var(--radius-md)] border border-[var(--border)] bg-[var(--bg-panel)] text-[12px] text-[var(--text-secondary)]">
        <Trash2 size={13} className={pending.status === "confirmed" ? "text-[var(--danger)]" : ""} />
        {pending.status === "confirmed"
          ? `Đã xóa "${pending.title}" (Ctrl+Z để hoàn tác)`
          : `Đã hủy xóa "${pending.title}"`}
      </div>
    );
  }

  return (
    <div className="my-1 px-3 py-2.5 rounded-[var(--radius-md)] border border-[var(--danger)]/40 bg-[var(--danger)]/5">
      <div className="flex items-center gap-2 text-[12.5px] text-[var(--text)]">
        <AlertTriangle size={14} className="text-[var(--danger)]" />
        Xóa ghi chú <b>"{pending.title}"</b>?
      </div>
      <div className="text-[11px] text-[var(--text-secondary)] mt-0.5">
        Ghi chú chuyển vào thùng rác — có thể hoàn tác bằng Ctrl+Z.
      </div>
      <div className="flex gap-2 mt-2">
        <button
          onClick={() => void confirmDelete(pending.id)}
          className="px-3 py-1 rounded-[var(--radius-sm)] bg-[var(--danger)] text-white text-[12px] font-medium hover:opacity-90"
        >
          Xóa
        </button>
        <button
          onClick={() => cancelDelete(pending.id)}
          className="px-3 py-1 rounded-[var(--radius-sm)] border border-[var(--border)] text-[12px] text-[var(--text-secondary)] hover:border-[var(--text-secondary)]"
        >
          Hủy
        </button>
      </div>
    </div>
  );
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={async () => {
        await navigator.clipboard.writeText(text);
        setCopied(true);
        setTimeout(() => setCopied(false), 1500);
      }}
      title="Copy"
      className="absolute top-1 right-1 p-1 rounded opacity-0 group-hover:opacity-100 hover:bg-[var(--bg-hover)] text-[var(--text-faint)] transition-opacity"
    >
      {copied ? <Check size={12} /> : <Copy size={12} />}
    </button>
  );
}

export function MessageList({ messages, streaming }: { messages: UiMessage[]; streaming: boolean }) {
  return (
    <div className="px-3 py-3 flex flex-col gap-3">
      {messages.map((m) =>
        m.role === "user" ? (
          <div key={m.id} className="group relative self-end max-w-[92%]">
            <div className="px-3.5 py-2 rounded-[var(--radius-lg)] rounded-br-sm bg-[var(--accent)] text-white text-[13.5px] whitespace-pre-wrap break-words">
              {m.content}
            </div>
            <CopyButton text={m.content} />
          </div>
        ) : (
          <div key={m.id} className="self-start max-w-[100%] w-full">
            {m.toolCalls?.map((tc) => <ToolCallCard key={tc.id} call={tc} />)}
            {m.pendingDelete && <DeleteConfirmCard pending={m.pendingDelete} />}
            {m.content && (
              <div className="group relative">
                <Markdown text={m.content} />
                <CopyButton text={m.content} />
              </div>
            )}
            {m.error && (
              <div className="mt-1 px-3 py-2 rounded-[var(--radius-md)] border border-[var(--danger)]/40 text-[12px] text-[var(--danger)]">
                {m.error}
              </div>
            )}
            {streaming && !m.content && !m.error && (m.toolCalls?.length ?? 0) === 0 && (
              <div className="text-[12px] text-[var(--text-faint)] animate-pulse">Đang suy nghĩ…</div>
            )}
          </div>
        ),
      )}
    </div>
  );
}
