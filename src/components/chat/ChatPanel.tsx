import { useEffect, useRef, useState } from "react";
import { Maximize2, Minimize2, Sparkles, SquarePen, X } from "lucide-react";
import { useChatStore } from "../../lib/store/chatStore";
import { useComposerStore } from "../../lib/store/composerStore";
import { useSettingsStore } from "../../lib/store/settingsStore";
import { useNotesStore } from "../../lib/store/notesStore";
import { useUi } from "../../lib/store/uiStore";
import { useT } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { ContentHeader } from "../layout/ContentHeader";
import { IconButton } from "../ui/Button";
import { MessageList } from "./MessageList";
import { Composer, type ComposerHandle } from "./composer/Composer";
import { ModelPicker } from "./ModelPicker";

interface ChatPanelProps {
  /** `side` = docked next to the editor; `full` = the whole content area. */
  variant: "side" | "full";
}

export function ChatPanel({ variant }: ChatPanelProps) {
  const t = useT();
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
  const [dropping, setDropping] = useState(false);
  const addFiles = useComposerStore((s) => s.addAttachmentFiles);

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
  const placeholder = isSide ? t("chat.askAboutNote") : t("chat.askAnything");

  const errorBanner = error && (
    <div role="alert" className="mb-3 rounded-md border border-danger-border bg-danger-fill px-3 py-2.5 text-footnote text-fg">
      {error}
    </div>
  );

  const suggestions = (
    <div className="flex flex-wrap justify-center gap-2">
      {(isSide
        ? [
            { label: t("chat.suggest.summarize"), prompt: t("chat.suggest.summarizePrompt") },
            { label: t("chat.suggest.todos"), prompt: t("chat.suggest.todosPrompt") },
            { label: t("chat.suggest.rewrite"), prompt: t("chat.suggest.rewritePrompt") },
          ]
        : [
            { label: t("chat.suggest.findNotes"), prompt: t("chat.suggest.findNotesPrompt") },
            { label: t("chat.suggest.weeklyChecklist"), prompt: t("chat.suggest.weeklyChecklistPrompt") },
            { label: t("chat.suggest.stats"), prompt: t("chat.suggest.statsPrompt") },
          ]
      ).map((s) => (
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
      <ModelPicker compact={isSide} />
    </>
  );

  const headerTrailing = isSide ? (
    <>
      <IconButton label={t("chat.newConversation")} onClick={() => void newChat()}>
        <SquarePen size={16} strokeWidth={1.75} aria-hidden="true" />
      </IconButton>
      <IconButton
        label={t("chat.openFull")}
        onClick={() => {
          setChatOpen(false);
          setSection("chat");
        }}
      >
        <Maximize2 size={15} strokeWidth={1.75} aria-hidden="true" />
      </IconButton>
      <IconButton label={t("chat.closeAssistant")} onClick={() => setChatOpen(false)}>
        <X size={17} strokeWidth={1.75} aria-hidden="true" />
      </IconButton>
    </>
  ) : (
    <IconButton
      label={t("chat.dockToNote")}
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
      aria-label={t("chat.panelLabel")}
      className={cn(
        "relative flex min-w-0 flex-col bg-app",
        isSide ? "w-[384px] shrink-0 border-l border-hairline" : "flex-1",
      )}
      onDragOver={(e) => {
        if (e.dataTransfer.types.includes("Files")) {
          e.preventDefault();
          setDropping(true);
        }
      }}
      onDragLeave={(e) => {
        if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false);
      }}
      onDrop={(e) => {
        const files = Array.from(e.dataTransfer.files);
        if (files.length) {
          e.preventDefault();
          setDropping(false);
          void addFiles(useChatStore.getState().chatId, files);
        }
      }}
    >
      {dropping && (
        <div className="absolute inset-0 z-20 m-2 flex items-center justify-center rounded-lg border-2 border-dashed border-accent bg-app/85">
          <p className="text-callout font-medium text-fg">{t("chat.dropFiles")}</p>
        </div>
      )}
      <ContentHeader leading={headerLeading} trailing={headerTrailing} />

      {!empty && (
        <div ref={scrollHost} className="min-h-0 flex-1 overflow-y-auto">
          <div className={cn("mx-auto w-full pb-4 pt-2", column)}>
            <MessageList messages={messages} streaming={status === "streaming"} />
          </div>
        </div>
      )}
      <div
        className={cn(
          "mx-auto w-full",
          column,
          empty ? "flex flex-1 flex-col justify-center gap-5 pb-[12vh]" : "pb-2.5",
        )}
      >
        {empty && (
          <h2 className={cn("text-center font-semibold text-fg", isSide ? "text-headline" : "text-large-title")}>
            {isSide
              ? selectedTitle
                ? t("chat.emptySideWithNote", { title: selectedTitle })
                : t("chat.emptySide")
              : t("chat.emptyFull")}
          </h2>
        )}
        {errorBanner}
        <Composer key={chatId} ref={composerRef} placeholder={placeholder} compact={isSide} />
        {empty ? suggestions : (
          <p className="pt-1.5 text-center text-caption text-fg-tertiary">
            {t("chat.disclaimer")}
          </p>
        )}
      </div>
    </section>
  );
}
