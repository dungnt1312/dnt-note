import { useEffect, useId, useMemo, useRef, useState } from "react";
import { Check, Loader2, Plus, Search } from "lucide-react";
import { fuzzyRank } from "../../lib/fuzzy";
import { mergeModelLists } from "../../lib/llm/models";
import { cn } from "../../lib/utils";
import { PillButton, SecondaryButton } from "../ui/Button";
import { Overlay } from "../ui/Dialog";

interface ModelPickerDialogProps {
  open: boolean;
  providerName: string;
  /** Models already saved for the provider; they start ticked. */
  saved: string[];
  /** Fetches the provider's model list (GET /models). */
  loadModels: () => Promise<string[]>;
  onSave: (models: string[]) => void;
  onClose: () => void;
}

/** Tick any number of models from the provider's list, or type a name to add one by hand. */
export function ModelPickerDialog({ open, providerName, onClose, ...rest }: ModelPickerDialogProps) {
  return (
    <Overlay open={open} onClose={onClose} label={`Chọn model cho ${providerName}`} placement="top" className="w-[520px]">
      <PickerBody providerName={providerName} onClose={onClose} {...rest} />
    </Overlay>
  );
}

type FetchState = { kind: "loading" } | { kind: "ok"; models: string[] } | { kind: "fail"; message: string };
type Row = { kind: "model" | "add"; name: string };

function PickerBody({ providerName, saved, loadModels, onSave, onClose }: Omit<ModelPickerDialogProps, "open">) {
  const [fetchState, setFetchState] = useState<FetchState>({ kind: "loading" });
  const [attempt, setAttempt] = useState(0);
  const [picked, setPicked] = useState<string[]>(saved);
  const [added, setAdded] = useState<string[]>([]);
  const [query, setQuery] = useState("");
  const [cursor, setCursor] = useState(0);
  const listRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const load = useRef(loadModels);
  load.current = loadModels;
  const listId = useId();

  useEffect(() => {
    let alive = true;
    setFetchState({ kind: "loading" });
    load.current().then(
      (models) => alive && setFetchState({ kind: "ok", models }),
      (e: unknown) => alive && setFetchState({ kind: "fail", message: e instanceof Error ? e.message : String(e) }),
    );
    return () => {
      alive = false;
    };
  }, [attempt]);

  const all = useMemo(
    () => mergeModelLists([...saved, ...added], fetchState.kind === "ok" ? fetchState.models : []),
    [saved, added, fetchState],
  );

  const q = query.trim();
  const rows = useMemo(() => {
    const names = q ? fuzzyRank(all, q).map((r) => r.item) : all;
    const list: Row[] = names.map((name) => ({ kind: "model", name }));
    if (q && !all.includes(q)) list.push({ kind: "add", name: q });
    return list;
  }, [all, q]);

  useEffect(() => setCursor(0), [q]);

  useEffect(() => {
    listRef.current?.querySelector<HTMLElement>(`[data-idx="${cursor}"]`)?.scrollIntoView({ block: "nearest" });
  }, [cursor]);

  const activate = (row: Row) => {
    if (row.kind === "add") {
      setAdded((a) => [...a, row.name]);
      setPicked((p) => [...p, row.name]);
      setQuery("");
      return;
    }
    setPicked((p) => (p.includes(row.name) ? p.filter((m) => m !== row.name) : [...p, row.name]));
  };

  const fetchedCount = fetchState.kind === "ok" ? fetchState.models.length : null;

  return (
    <>
      <div className="px-4 pb-3 pt-4">
        <h2 className="text-headline font-semibold text-fg">Chọn model</h2>
        <p className="mt-0.5 text-footnote text-fg-secondary">
          {providerName}
          {fetchedCount !== null && ` · ${fetchedCount} model có sẵn`}
        </p>
      </div>
      <div className="mx-4 mb-3 flex h-9 items-center gap-2 rounded-sm border border-hairline bg-app px-3 focus-within:border-fg-tertiary">
        <Search size={14} aria-hidden="true" className="shrink-0 text-fg-tertiary" />
        <input
          ref={inputRef}
          data-autofocus
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown" || e.key === "ArrowUp") {
              e.preventDefault();
              const last = rows.length - 1;
              setCursor((c) => (e.key === "ArrowDown" ? Math.min(c + 1, last) : Math.max(c - 1, 0)));
            } else if (e.key === "Enter" && !e.nativeEvent.isComposing) {
              e.preventDefault();
              const row = rows[cursor];
              if (row) activate(row);
            }
          }}
          placeholder="Tìm hoặc nhập tên model…"
          aria-label="Tìm hoặc nhập tên model"
          role="combobox"
          aria-expanded="true"
          aria-controls={listId}
          aria-activedescendant={rows[cursor] ? `${listId}-${cursor}` : undefined}
          autoComplete="off"
          spellCheck={false}
          className="min-w-0 flex-1 bg-transparent text-callout text-fg outline-none"
        />
      </div>
      <div className="h-px bg-hairline" />

      {fetchState.kind === "loading" && (
        <p className="flex items-center gap-2 px-4 pt-3 text-footnote text-fg-secondary">
          <Loader2 size={13} aria-hidden="true" className="animate-spin" /> Đang tải danh sách model…
        </p>
      )}
      {fetchState.kind === "fail" && (
        <div role="alert" className="mx-3 mt-3 flex items-start gap-3 rounded-sm border border-danger-border bg-danger-fill px-3 py-2">
          <p className="min-w-0 flex-1 break-words text-footnote text-fg">
            Không tải được danh sách model: {fetchState.message}. Bạn vẫn có thể gõ tên model để thêm.
          </p>
          <SecondaryButton
            className="h-7 shrink-0 px-3"
            onClick={() => {
              inputRef.current?.focus();
              setAttempt((n) => n + 1);
            }}
          >
            Thử lại
          </SecondaryButton>
        </div>
      )}

      <div
        ref={listRef}
        id={listId}
        role="listbox"
        aria-label="Model"
        aria-multiselectable="true"
        className="max-h-[min(340px,calc(100vh-360px))] min-h-[96px] overflow-y-auto p-1.5"
      >
        {rows.length === 0 && fetchState.kind !== "loading" && (
          <p className="py-7 text-center text-callout text-fg-secondary">Chưa có model nào — gõ tên model để thêm</p>
        )}
        {rows.map((row, i) => {
          const checked = row.kind === "model" && picked.includes(row.name);
          return (
            <button
              key={`${row.kind}:${row.name}`}
              type="button"
              id={`${listId}-${i}`}
              role="option"
              aria-selected={checked}
              data-idx={i}
              tabIndex={-1}
              onMouseDown={(e) => e.preventDefault()}
              onMouseMove={() => setCursor(i)}
              onClick={() => activate(row)}
              className={cn("flex h-9 w-full items-center gap-2.5 rounded-sm px-2.5 text-left", i === cursor && "bg-hover")}
            >
              {row.kind === "model" ? (
                <span
                  aria-hidden="true"
                  className={cn(
                    "flex size-4 shrink-0 items-center justify-center rounded-[5px] border transition-colors",
                    checked ? "border-accent bg-accent text-accent-fg" : "border-fg-tertiary",
                  )}
                >
                  {checked && <Check size={11} strokeWidth={3} />}
                </span>
              ) : (
                <Plus size={15} aria-hidden="true" className="shrink-0 text-fg-secondary" />
              )}
              <span className="min-w-0 flex-1 truncate text-callout text-fg">
                {row.kind === "add" ? `Thêm “${row.name}”` : row.name}
              </span>
            </button>
          );
        })}
      </div>

      <div className="h-px bg-hairline" />
      <div className="flex items-center gap-2 px-4 py-3">
        <span aria-live="polite" className="flex-1 text-footnote text-fg-secondary">
          Đã chọn {picked.length} model
        </span>
        <SecondaryButton onClick={onClose}>Hủy</SecondaryButton>
        <PillButton className="h-8 px-3.5" onClick={() => onSave(picked)}>
          Lưu
        </PillButton>
      </div>
    </>
  );
}
