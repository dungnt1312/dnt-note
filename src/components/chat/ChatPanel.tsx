import { useEffect, useRef } from "react";
import { Check, ChevronDown, Maximize2, Minimize2, Settings2, Sparkles, SquarePen, X } from "lucide-react";
import { useChatStore } from "../../lib/store/chatStore";
import { useSettingsStore } from "../../lib/store/settingsStore";
import { useNotesStore } from "../../lib/store/notesStore";
import { useUi } from "../../lib/store/uiStore";
import { cn } from "../../lib/utils";
import { ContentHeader } from "../layout/ContentHeader";
import { IconButton } from "../ui/Button";
import { Menu, MenuItem, MenuLabel, MenuSeparator } from "../ui/Menu";
import { MessageList } from "./MessageList";
import { Composer, type ComposerHandle } from "./Composer";

function ProviderPicker({ compact }: { compact: boolean }) {
  const providers = useSettingsStore((s) => s.providers);
  const activeId = useSettingsStore((s) => s.activeProviderId);
  const setActive = useSettingsStore((s) => s.setActiveProvider);
  const setSection = useUi((s) => s.setSection);
  const active = providers.find((p) => p.id === activeId) ?? providers[0];

  return (
    <Menu
      align="start"
      width={260}
      trigger={(p) => (
        <button
          type="button"
          {...p}
          title="Chọn nhà cung cấp / model"
          className={cn(
            "inline-flex h-8 min-w-0 items-center gap-1 rounded-sm px-2 font-semibold text-fg transition-colors hover:bg-hover",
            compact ? "text-callout" : "text-headline",
          )}
        >
          <span className="truncate">{active ? active.model || active.name : "Chưa cấu hình AI"}</span>
          <ChevronDown size={14} strokeWidth={2.25} aria-hidden="true" className="shrink-0 text-fg-tertiary" />
        </button>
      )}
    >
      {providers.length > 0 && <MenuLabel>Nhà cung cấp</MenuLabel>}
      {providers.map((pr) => (
        <MenuItem
          key={pr.id}
          icon={pr.id === active?.id ? <Check size={14} /> : <span />}
          hint={pr.name}
          onSelect={() => setActive(pr.id)}
        >
          {pr.model || pr.name}
        </MenuItem>
      ))}
      {providers.length > 0 && <MenuSeparator />}
      <MenuItem icon={<Settings2 size={14} />} onSelect={() => setSection("settings")}>
        Quản lý nhà cung cấp…
      </MenuItem>
    </Menu>
  );
}

const SUGGESTIONS_SIDE = [
  { label: "Tóm tắt", prompt: "Tóm tắt ghi chú đang mở thành các ý chính." },
  { label: "Việc cần làm", prompt: "Liệt kê các việc cần làm trong ghi chú đang mở dưới dạng checklist." },
  { label: "Viết lại", prompt: "Viết lại ghi chú đang mở cho rõ ràng, mạch lạc hơn." },
];
const SUGGESTIONS_FULL = [
  { label: "Tìm ghi chú", prompt: "Tìm các ghi chú nói về " },
  { label: "Tạo checklist tuần này", prompt: "Tạo một ghi chú checklist cho tuần này." },
  { label: "Thống kê ghi chú", prompt: "Cho tôi biết thống kê về các ghi chú của tôi." },
];

interface ChatPanelProps {
  /** `side` = docked next to the editor; `full` = the whole content area. */
  variant: "side" | "full";
}

export function ChatPanel({ variant }: ChatPanelProps) {
  const isSide = variant === "side";
  const setChatOpen = useUi((s) => s.setChatOpen);
  const setSection = useUi((s) => s.setSection);
  const messages = useChatStore((s) => s.messages);
  const status = useChatStore((s) => s.status);
  const error = useChatStore((s) => s.error);
  const newChat = useChatStore((s) => s.newChat);
  const loadStore = useSettingsStore((s) => s.loadStore);
  const loaded = useSettingsStore((s) => s.loaded);
  const selectedTitle = useNotesStore((s) => s.notes.find((n) => n.id === s.selectedId)?.title);

  const scrollHost = useRef<HTMLDivElement | null>(null);
  const composerRef = useRef<ComposerHandle>(null);

  useEffect(() => {
    if (!loaded) void loadStore();
  }, [loaded, loadStore]);

  const chatId = useChatStore((s) => s.chatId);
  const seen = useRef({ chatId: "", count: 0 });

  useEffect(() => {
    const el = scrollHost.current;
    if (!el) return;
    const prev = seen.current;
    seen.current = { chatId, count: messages.length };
    // Jump to the end when a chat opens or a new message is added; while a reply
    // streams, follow it only if the user has not scrolled up to read.
    const jump = prev.chatId !== chatId || messages.length > prev.count;
    if (jump || el.scrollHeight - el.scrollTop - el.clientHeight < 160) {
      el.scrollTo({ top: el.scrollHeight });
    }
  }, [messages, chatId]);

  const column = isSide ? "max-w-none px-4" : "max-w-[760px] px-6";
  const empty = messages.length === 0;
  const placeholder = isSide ? "Hỏi về ghi chú này…" : "Hỏi bất kỳ điều gì";

  const errorBanner = error && (
    <div role="alert" className="mb-3 rounded-md border border-danger-border bg-danger-fill px-3 py-2.5 text-footnote text-fg">
      {error}
    </div>
  );

  const suggestions = (
    <div className="flex flex-wrap justify-center gap-2">
      {(isSide ? SUGGESTIONS_SIDE : SUGGESTIONS_FULL).map((s) => (
        <button
          key={s.label}
          type="button"
          onClick={() => composerRef.current?.setText(s.prompt)}
          className="inline-flex h-[34px] items-center rounded-full border border-hairline bg-app px-3.5 text-callout text-fg transition-colors hover:bg-hover"
        >
          {s.label}
        </button>
      ))}
    </div>
  );

  const headerLeading = (
    <>
      {isSide && <Sparkles size={14} aria-hidden="true" className="ml-1 shrink-0 text-fg-secondary" />}
      <ProviderPicker compact={isSide} />
    </>
  );

  const headerTrailing = isSide ? (
    <>
      <IconButton label="Hội thoại mới" onClick={() => void newChat()}>
        <SquarePen size={16} strokeWidth={1.75} aria-hidden="true" />
      </IconButton>
      <IconButton
        label="Mở toàn màn hình (Ctrl+2)"
        onClick={() => {
          setChatOpen(false);
          setSection("chat");
        }}
      >
        <Maximize2 size={15} strokeWidth={1.75} aria-hidden="true" />
      </IconButton>
      <IconButton label="Đóng trợ lý (Ctrl+Shift+J)" onClick={() => setChatOpen(false)}>
        <X size={17} strokeWidth={1.75} aria-hidden="true" />
      </IconButton>
    </>
  ) : (
    <IconButton
      label="Thu về cạnh ghi chú"
      onClick={() => {
        setSection("notes");
        setChatOpen(true);
      }}
    >
      <Minimize2 size={15} strokeWidth={1.75} aria-hidden="true" />
    </IconButton>
  );

  return (
    <section
      aria-label="Trợ lý AI"
      className={cn(
        "flex min-w-0 flex-col bg-app",
        isSide ? "w-[384px] shrink-0 border-l border-hairline" : "flex-1",
      )}
    >
      <ContentHeader leading={headerLeading} trailing={headerTrailing} />

      {empty ? (
        <div className={cn("mx-auto flex w-full flex-1 flex-col justify-center gap-5 pb-[12vh]", column)}>
          <h2 className={cn("text-center font-semibold text-fg", isSide ? "text-headline" : "text-large-title")}>
            {isSide
              ? selectedTitle
                ? `Hỏi gì về “${selectedTitle}”?`
                : "Hỏi trợ lý bất cứ điều gì"
              : "Hôm nay bạn cần giúp gì?"}
          </h2>
          {errorBanner}
          <Composer ref={composerRef} placeholder={placeholder} compact={isSide} />
          {suggestions}
        </div>
      ) : (
        <>
          <div ref={scrollHost} className="min-h-0 flex-1 overflow-y-auto">
            <div className={cn("mx-auto w-full pb-4 pt-2", column)}>
              <MessageList messages={messages} streaming={status === "streaming"} />
            </div>
          </div>
          <div className={cn("mx-auto w-full pb-2.5", column)}>
            {errorBanner}
            <Composer ref={composerRef} placeholder={placeholder} compact={isSide} />
            <p className="pt-1.5 text-center text-caption text-fg-tertiary">
              AI có thể mắc lỗi — hãy kiểm tra lại thông tin quan trọng.
            </p>
          </div>
        </>
      )}
    </section>
  );
}
