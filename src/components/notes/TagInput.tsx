import { useState } from "react";
import { X } from "lucide-react";

interface TagInputProps {
  tags: string[];
  onChange: (tags: string[]) => void;
}

export function TagInput({ tags, onChange }: TagInputProps) {
  const [draft, setDraft] = useState("");

  const commit = () => {
    const t = draft.trim().toLowerCase();
    if (t && !tags.includes(t)) onChange([...tags, t]);
    setDraft("");
  };

  return (
    <div className="flex items-center gap-1.5 flex-wrap">
      {tags.map((t) => (
        <span
          key={t}
          className="flex items-center gap-1 text-[11px] px-2 py-0.5 rounded-full bg-[var(--accent-soft)] text-[var(--accent)]"
        >
          {t}
          <button
            onClick={() => onChange(tags.filter((x) => x !== t))}
            className="hover:opacity-70"
            title={`Xóa tag ${t}`}
          >
            <X size={10} />
          </button>
        </span>
      ))}
      <input
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" || e.key === ",") {
            e.preventDefault();
            commit();
          } else if (e.key === "Backspace" && !draft && tags.length > 0) {
            onChange(tags.slice(0, -1));
          }
        }}
        onBlur={commit}
        placeholder="+ tag"
        className="text-[11px] px-1 py-0.5 w-16 bg-transparent outline-none text-[var(--text)] placeholder:text-[var(--text-faint)]"
      />
    </div>
  );
}
