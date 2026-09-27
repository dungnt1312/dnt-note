import { useRef, useState } from "react";
import { Plus, X } from "lucide-react";

interface TagStripProps {
  tags: string[];
  onChange: (tags: string[]) => void;
}

export function normalizeTag(raw: string): string {
  return raw.trim().toLowerCase().replace(/^#+/, "").replace(/\s+/g, "-");
}

/** Tags right under the title (Notion style): `#tag` chips + a ghost "Thêm thẻ" chip. */
export function TagStrip({ tags, onChange }: TagStripProps) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);

  const commit = () => {
    const t = normalizeTag(draft);
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft("");
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5" role="group" aria-label="Thẻ">
      {tags.map((t) => (
        <span
          key={t}
          className="group/tag inline-flex h-6 items-center rounded-full bg-hover px-2.5 text-footnote font-medium text-fg-secondary focus-within:pr-1.5 hover:pr-1.5"
        >
          #{t}
          <button
            type="button"
            aria-label={`Xóa thẻ ${t}`}
            title="Xóa thẻ"
            onClick={() => onChange(tags.filter((x) => x !== t))}
            className="flex h-4 w-0 items-center justify-center overflow-hidden rounded-full text-fg-tertiary hover:bg-selected hover:text-fg group-focus-within/tag:ml-1 group-focus-within/tag:w-4 group-hover/tag:ml-1 group-hover/tag:w-4"
          >
            <X size={10} strokeWidth={2.5} aria-hidden="true" />
          </button>
        </span>
      ))}
      {adding ? (
        <input
          ref={inputRef}
          autoFocus
          value={draft}
          aria-label="Tên thẻ mới"
          placeholder="tên thẻ"
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === ",") {
              e.preventDefault();
              commit();
            } else if (e.key === "Escape") {
              e.stopPropagation();
              setDraft("");
              setAdding(false);
            } else if (e.key === "Backspace" && !draft && tags.length > 0) {
              onChange(tags.slice(0, -1));
            }
          }}
          onBlur={() => {
            commit();
            setAdding(false);
          }}
          className="h-6 w-28 rounded-full border border-hairline bg-transparent px-2.5 text-footnote text-fg outline-none focus:border-fg-tertiary"
        />
      ) : (
        <button
          type="button"
          onClick={() => setAdding(true)}
          aria-label="Thêm thẻ"
          className="inline-flex h-6 items-center gap-1 rounded-full px-2 text-footnote font-medium text-fg-tertiary transition-colors hover:bg-hover hover:text-fg-secondary"
        >
          <Plus size={11} strokeWidth={2.5} aria-hidden="true" />
          {tags.length === 0 && "Thêm thẻ"}
        </button>
      )}
    </div>
  );
}
