import { useEffect, useRef } from "react";
import { Plus, PanelRightClose, Bot } from "lucide-react";
import { useChatStore } from "../../lib/store/chatStore";
import { useSettingsStore } from "../../lib/store/settingsStore";
import { useUi } from "../../lib/store/uiStore";
import { MessageList } from "./MessageList";
import { Composer } from "./Composer";

function ModelPicker() {
  const providers = useSettingsStore((s) => s.providers);
  const activeProviderId = useSettingsStore((s) => s.activeProviderId);
  const setActive = useSettingsStore((s) => s.setActiveProvider);

  return (
    <select
      value={activeProviderId ?? ""}
      onChange={(e) => setActive(e.target.value || null)}
      className="max-w-[180px] truncate text-[12px] px-2 py-1 rounded-[var(--radius-sm)] bg-[var(--bg-panel)] border border-[var(--border)] outline-none text-[var(--text)]"
      title="Chọn provider/model"
    >
      {providers.length === 0 && <option value="">Chưa cấu hình AI</option>}
      {providers.map((p) => (
        <option key={p.id} value={p.id}>
          {p.name} · {p.model}
        </option>
      ))}
    </select>
  );
}

export function ChatPanel() {
  const chatOpen = useUi((s) => s.chatOpen);
  const setChatOpen = useUi((s) => s.setChatOpen);
  const messages = useChatStore((s) => s.messages);
  const status = useChatStore((s) => s.status);
  const newChat = useChatStore((s) => s.newChat);

  const scrollHost = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    scrollHost.current?.scrollTo({ top: scrollHost.current.scrollHeight });
  }, [messages]);

  if (!chatOpen) return null;

  return (
    <aside className="w-[380px] shrink-0 flex flex-col border-l border-[var(--border)] bg-[var(--bg-panel)]">
      <div className="h-10 flex items-center gap-2 px-3 border-b border-[var(--border)]">
        <Bot size={15} className="text-[var(--accent)]" />
        <span className="text-[13px] font-semibold text-[var(--text)] flex-1">Trợ lý AI</span>
        <ModelPicker />
        <button
          onClick={() => void newChat()}
          title="Phiên chat mới"
          className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
        >
          <Plus size={15} />
        </button>
        <button
          onClick={() => setChatOpen(false)}
          title="Đóng chat"
          className="p-1.5 rounded-[var(--radius-sm)] hover:bg-[var(--bg-hover)] text-[var(--text-secondary)]"
        >
          <PanelRightClose size={15} />
        </button>
      </div>

      <div ref={scrollHost} className="flex-1 overflow-y-auto">
        {messages.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 text-[var(--text-faint)] px-6 text-center">
            <Bot size={28} />
            <p className="text-[13px] text-[var(--text-secondary)]">
              Hỏi bất cứ điều gì về ghi chú của bạn
            </p>
            <p className="text-[12px]">
              Ví dụ: "tìm các note về markdown", "tạo checklist cho tuần này",
              "tóm tắt note đang mở" — dùng <kbd className="px-1 rounded bg-[var(--bg-hover)]">@</kbd> để đính kèm note.
            </p>
          </div>
        ) : (
          <MessageList messages={messages} streaming={status === "streaming"} />
        )}
      </div>

      <Composer disabled={false} />
    </aside>
  );
}
