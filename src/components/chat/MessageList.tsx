import { useState, type ComponentProps, type ReactNode } from "react";
import ReactMarkdown, { defaultUrlTransform } from "react-markdown";
import remarkGfm from "remark-gfm";
import {
  AlertTriangle,
  Check,
  ChevronRight,
  Copy,
  FileText,
  FilePlus2,
  Pencil,
  RotateCcw,
  Search,
  Tags,
  TextQuote,
  Trash2,
  Wrench,
} from "lucide-react";
import type { UiMessage, UiToolCall } from "../../lib/store/chatStore";
import { useChatStore } from "../../lib/store/chatStore";
import { useNotesStore } from "../../lib/store/notesStore";
import { useUi } from "../../lib/store/uiStore";
import { useT } from "../../lib/i18n";
import { openNoteById, parseNoteHref } from "../../lib/openNote";
import { api } from "../../lib/api/notes";
import { cn } from "../../lib/utils";
import { PillButton, SecondaryButton } from "../ui/Button";

type TFn = ReturnType<typeof useT>;

function toolLabel(name: string, t: TFn): string {
  const labels: Record<string, string> = {
    list_notes: t("chat.tool.listNotes"),
    get_recent_notes: t("chat.tool.getRecentNotes"),
    search_notes: t("chat.tool.searchNotes"),
    read_note: t("chat.tool.readNote"),
    create_note: t("chat.tool.createNote"),
    update_note: t("chat.tool.updateNote"),
    delete_note: t("chat.tool.deleteNote"),
    get_stats: t("chat.tool.getStats"),
    list_tags: t("chat.tool.listTags"),
    set_tags: t("chat.tool.setTags"),
  };
  return labels[name] ?? name;
}

function toolIcon(name: string) {
  if (name === "delete_note") return <Trash2 size={11} />;
  if (name === "create_note") return <FilePlus2 size={11} />;
  if (name === "update_note") return <Pencil size={11} />;
  if (name === "search_notes") return <Search size={11} />;
  if (name === "set_tags" || name === "list_tags") return <Tags size={11} />;
  return <FileText size={11} />;
}

function pretty(raw: string | undefined): string {
  if (!raw) return "";
  try {
    return JSON.stringify(JSON.parse(raw), null, 2);
  } catch {
    return raw;
  }
}

/** `[Tên](note://<id>)` links from the assistant open that note in the editor. */
function NoteAnchor({ href, children }: ComponentProps<"a">) {
  const t = useT();
  const id = href ? parseNoteHref(href) : null;
  if (!id) return <a href={href}>{children}</a>;
  return (
    <button
      type="button"
      title={t("chat.openThisNote")}
      onClick={() => void openNoteById(id)}
      className="inline-flex max-w-full items-center gap-1 rounded-full border border-hairline bg-subtle px-2 py-0.5 font-normal text-accent transition-colors hover:bg-hover hover:text-accent"
    >
      <FileText size={12} aria-hidden="true" className="shrink-0" />
      <span className="truncate underline decoration-fg-tertiary underline-offset-2">{children}</span>
    </button>
  );
}

function Markdown({ text }: { text: string }) {
  return (
    <div
      className={cn(
        "select-text break-words text-body text-fg",
        "[&>*+*]:mt-3 [&_li+li]:mt-1",
        "[&_a]:underline [&_a]:decoration-fg-tertiary [&_a]:underline-offset-2",
        "[&_h1]:text-title [&_h1]:font-semibold [&_h2]:text-headline [&_h2]:font-semibold [&_h3]:font-semibold",
        "[&_strong]:font-semibold",
        "[&_ul]:list-disc [&_ul]:pl-5 [&_ol]:list-decimal [&_ol]:pl-5",
        "[&_blockquote]:border-l-[3px] [&_blockquote]:border-hairline [&_blockquote]:pl-3.5 [&_blockquote]:text-fg-secondary",
        "[&_:not(pre)>code]:rounded-[5px] [&_:not(pre)>code]:border [&_:not(pre)>code]:border-hairline [&_:not(pre)>code]:bg-subtle [&_:not(pre)>code]:px-1 [&_:not(pre)>code]:font-mono [&_:not(pre)>code]:text-callout",
        "[&_pre]:overflow-x-auto [&_pre]:rounded-sm [&_pre]:border [&_pre]:border-hairline [&_pre]:bg-subtle [&_pre]:p-3 [&_pre]:font-mono [&_pre]:text-callout",
        "[&_table]:w-full [&_table]:border-collapse [&_table]:text-callout [&_td]:border [&_td]:border-hairline [&_td]:px-2 [&_td]:py-1 [&_th]:border [&_th]:border-hairline [&_th]:bg-subtle [&_th]:px-2 [&_th]:py-1 [&_th]:text-left",
        "[&_hr]:border-hairline",
      )}
    >
      <ReactMarkdown
        remarkPlugins={[remarkGfm]}
        // `note://` is an app-internal protocol — keep it, sanitize everything else.
        urlTransform={(url) => (parseNoteHref(url) ? url : defaultUrlTransform(url))}
        components={{ a: NoteAnchor }}
      >
        {text}
      </ReactMarkdown>
    </div>
  );
}

function HoverAction({
  label,
  onClick,
  disabled,
  children,
}: {
  label: string;
  onClick: () => void;
  disabled?: boolean;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      disabled={disabled}
      onClick={onClick}
      className="flex size-7 items-center justify-center rounded-[7px] text-fg-secondary transition-colors hover:bg-hover hover:text-fg disabled:opacity-40"
    >
      {children}
    </button>
  );
}

function CopyAction({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  const t = useT();
  return (
    <HoverAction
      label={copied ? t("chat.copied") : t("chat.copyMessage")}
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
    >
      {copied ? <Check size={14} aria-hidden="true" /> : <Copy size={14} aria-hidden="true" />}
    </HoverAction>
  );
}

/** All tool calls of one reply collapsed into a single "Used N tools ›" line. */
function ToolActivity({ calls }: { calls: UiToolCall[] }) {
  const t = useT();
  const [open, setOpen] = useState(false);
  const [detail, setDetail] = useState<string | null>(null);
  const running = calls.some((c) => c.status === "running");
  const last = calls[calls.length - 1];
  const lastLabel = toolLabel(last.name, t);
  const summary = calls.length === 1 ? lastLabel : t("chat.toolUsed", { n: calls.length, last: lastLabel });

  return (
    <div className="mb-2">
      <button
        type="button"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        className="inline-flex max-w-full items-center gap-1.5 text-callout text-fg-secondary hover:text-fg"
      >
        <Wrench size={12} aria-hidden="true" className={cn(running && "animate-pulse")} />
        <span className="truncate">
          {summary}
          {running && "…"}
        </span>
        <ChevronRight
          size={12}
          strokeWidth={2.25}
          aria-hidden="true"
          className={cn("shrink-0 transition-transform", open && "rotate-90")}
        />
      </button>
      {open && (
        <ul className="ml-1.5 mt-1.5 flex flex-col gap-0.5 border-l border-hairline pl-2">
          {calls.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                aria-expanded={detail === c.id}
                onClick={() => setDetail(detail === c.id ? null : c.id)}
                className="flex items-center gap-1.5 py-0.5 pl-2 text-footnote text-fg-secondary hover:text-fg"
              >
                <span aria-hidden="true" className="flex w-3.5 justify-center text-fg-tertiary">
                  {toolIcon(c.name)}
                </span>
                {toolLabel(c.name, t)}
                <span className="text-caption text-fg-tertiary underline underline-offset-2">{t("chat.details")}</span>
              </button>
              {detail === c.id && (
                <pre className="ml-2 mt-1 max-h-[220px] select-text overflow-auto whitespace-pre-wrap break-all rounded-sm bg-subtle p-2.5 font-mono text-caption text-fg-secondary">
                  {`${t("chat.toolParams")}\n${pretty(c.args)}\n\n${t("chat.toolResult")}\n${pretty(c.result) || "…"}`}
                </pre>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function DeleteConfirmCard({ pending }: { pending: NonNullable<UiMessage["pendingDelete"]> }) {
  const t = useT();
  const confirmDelete = useChatStore((s) => s.confirmDelete);
  const cancelDelete = useChatStore((s) => s.cancelDelete);

  if (pending.status !== "pending") {
    return (
      <div className="mb-2 flex items-center gap-2 text-callout text-fg-secondary">
        <Trash2 size={13} aria-hidden="true" />
        {pending.status === "confirmed"
          ? t("chat.deletedNote", { title: pending.title })
          : t("chat.keptNote", { title: pending.title })}
      </div>
    );
  }

  return (
    <div role="alertdialog" aria-label={t("chat.deleteConfirmLabel")} className="mb-3 rounded-md border border-danger-border bg-control p-4">
      <div className="flex items-center gap-2 text-callout font-semibold text-fg">
        <AlertTriangle size={15} aria-hidden="true" className="text-danger" />
        {t("chat.deleteRequestTitle")}
      </div>
      <p className="mt-2 flex items-center gap-2 text-callout text-fg">
        <FileText size={13} aria-hidden="true" className="text-fg-tertiary" />
        {pending.title}
      </p>
      <p className="mt-1 text-footnote text-fg-secondary">{t("chat.deleteRequestDesc")}</p>
      <div className="mt-3 flex gap-2">
        <PillButton tone="danger" className="h-8 px-3.5" onClick={() => void confirmDelete(pending.id)}>
          {t("chat.delete")}
        </PillButton>
        <SecondaryButton onClick={() => void cancelDelete(pending.id)}>{t("chat.keep")}</SecondaryButton>
      </div>
    </div>
  );
}

function UserMessage({ message, onRetry, busy }: { message: UiMessage; onRetry?: () => void; busy: boolean }) {
  const t = useT();
  return (
    <div className="group flex flex-col items-end gap-1">
      {message.attachments && message.attachments.length > 0 && (
        <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
          {message.attachments.map((a) =>
            a.kind === "image" && a.previewUrl ? (
              <img
                key={a.id}
                src={a.previewUrl}
                alt={a.originalName}
                className="max-h-40 rounded-lg border border-hairline"
              />
            ) : (
              <span
                key={a.id}
                className="inline-flex h-6 max-w-[220px] items-center gap-1 rounded-full border border-hairline px-2 text-footnote text-fg-secondary"
              >
                <FileText size={11} aria-hidden="true" />
                <span className="truncate">{a.originalName}</span>
              </span>
            ),
          )}
        </div>
      )}
      {message.mentions && message.mentions.length > 0 && (
        <div className="flex flex-wrap justify-end gap-1">
          {message.mentions.map((m) =>
            m.failed ? (
              <span
                key={m.id}
                className="inline-flex h-6 items-center gap-1 rounded-full border border-hairline px-2 text-footnote text-fg-secondary"
              >
                <FileText size={11} aria-hidden="true" />
                {t("chat.failedMention", { title: m.title })}
              </span>
            ) : (
              <button
                key={m.id}
                type="button"
                title={t("chat.openThisNote")}
                onClick={() => void openNoteById(m.id)}
                className="inline-flex h-6 items-center gap-1 rounded-full border border-hairline px-2 text-footnote text-fg-secondary transition-colors hover:bg-hover hover:text-fg"
              >
                <FileText size={11} aria-hidden="true" />
                {m.title}
              </button>
            ),
          )}
        </div>
      )}
      {message.content && (
        <div className="max-w-[85%] select-text whitespace-pre-wrap break-words rounded-lg bg-bubble px-4 py-2.5 text-body text-fg">
          {message.content}
        </div>
      )}
      {message.content && (
        <div className="flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <CopyAction text={message.content} />
          {onRetry && (
            <HoverAction label={t("chat.resend")} onClick={onRetry} disabled={busy}>
              <RotateCcw size={14} aria-hidden="true" />
            </HoverAction>
          )}
        </div>
      )}
    </div>
  );
}

function AssistantMessage({ message, isLast, busy }: { message: UiMessage; isLast: boolean; busy: boolean }) {
  const t = useT();
  const retryLast = useChatStore((s) => s.retryLast);
  const selectedId = useNotesStore((s) => s.selectedId);
  const notes = useNotesStore((s) => s.notes);
  const pushToast = useUi((s) => s.pushToast);
  const streamingHere = busy && isLast;
  const selected = notes.find((n) => n.id === selectedId);

  const appendToNote = async () => {
    if (!selected) return;
    const store = useNotesStore.getState();
    const current = store.body ?? "";
    store.setBody(`${current.replace(/\s*$/, "")}\n\n${message.content}\n`);
    await store.flushSave();
    pushToast({ message: t("chat.insertedToast", { title: selected.title }), durationMs: 3000 });
  };

  const saveAsNote = async () => {
    const firstLine = message.content
      .split("\n")
      .find((l) => l.trim())
      ?.replace(/^#+\s*/, "")
      .slice(0, 60);
    const note = await api.notes.create(firstLine || t("chat.assistantReplyTitle"), message.content, []);
    await useNotesStore.getState().load();
    pushToast({ message: t("chat.savedAsNoteToast", { title: note.title }), durationMs: 3000 });
  };

  return (
    <div className="group">
      {message.toolCalls && message.toolCalls.length > 0 && <ToolActivity calls={message.toolCalls} />}
      {(message.pendingDeletes ?? (message.pendingDelete ? [message.pendingDelete] : [])).map((pending) => (
        <DeleteConfirmCard key={pending.id} pending={pending} />
      ))}
      {message.content && <Markdown text={message.content} />}
      {streamingHere && !message.content && !message.error && (message.toolCalls?.length ?? 0) === 0 && (
        <div className="flex items-center gap-2 py-1 text-callout text-fg-secondary" aria-live="polite">
          <span className="size-2.5 animate-pulse rounded-full bg-fg" aria-hidden="true" />
          {t("chat.thinking")}
        </div>
      )}
      {message.error && (
        <div role="alert" className="mt-2 flex items-start gap-2 rounded-md border border-danger-border bg-danger-fill px-3 py-2.5">
          <AlertTriangle size={14} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
          <div className="min-w-0 flex-1">
            <p className="text-footnote font-semibold text-fg">{t("chat.noReplyTitle")}</p>
            <p className="break-words text-footnote text-fg-secondary">{message.error}</p>
          </div>
          {isLast && (
            <SecondaryButton className="h-7 px-3" onClick={() => void retryLast()} disabled={busy}>
              {t("chat.retry")}
            </SecondaryButton>
          )}
        </div>
      )}
      {message.content && !streamingHere && (
        <div className="mt-1 flex opacity-0 transition-opacity focus-within:opacity-100 group-hover:opacity-100">
          <CopyAction text={message.content} />
          {selected && (
            <HoverAction label={t("chat.insertInto", { title: selected.title })} onClick={() => void appendToNote()}>
              <TextQuote size={14} aria-hidden="true" />
            </HoverAction>
          )}
          <HoverAction label={t("chat.saveAsNote")} onClick={() => void saveAsNote()}>
            <FilePlus2 size={14} aria-hidden="true" />
          </HoverAction>
          {isLast && (
            <HoverAction label={t("chat.regenerate")} onClick={() => void retryLast()} disabled={busy}>
              <RotateCcw size={14} aria-hidden="true" />
            </HoverAction>
          )}
        </div>
      )}
    </div>
  );
}

export function MessageList({ messages, streaming }: { messages: UiMessage[]; streaming: boolean }) {
  const t = useT();
  const retryLast = useChatStore((s) => s.retryLast);
  const lastUserIdx = messages.map((m) => m.role).lastIndexOf("user");
  return (
    <div className="flex flex-col gap-5" role="log" aria-label={t("chat.conversationLabel")} aria-busy={streaming}>
      {messages.map((m, i) =>
        m.role === "user" ? (
          <UserMessage
            key={m.id}
            message={m}
            busy={streaming}
            onRetry={i === lastUserIdx ? () => void retryLast() : undefined}
          />
        ) : (
          <AssistantMessage key={m.id} message={m} isLast={i === messages.length - 1} busy={streaming} />
        ),
      )}
    </div>
  );
}
