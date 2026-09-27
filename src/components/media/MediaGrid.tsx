import { FileText, Music, File } from "lucide-react";
import type { MediaItem } from "../../lib/api/media";
import { attachmentUrl } from "../../lib/media/attachmentUrl";
import { cn } from "../../lib/utils";

export function MediaIcon({ item, size = 28 }: { item: MediaItem; size?: number }) {
  const Icon = item.kind === "audio" ? Music : item.kind === "document" ? FileText : File;
  return <Icon size={size} strokeWidth={1.5} aria-hidden="true" className="text-fg-tertiary" />;
}

interface MediaGridProps {
  items: MediaItem[];
  selectedName: string | null;
  onSelect: (name: string) => void;
}

export function MediaGrid({ items, selectedName, onSelect }: MediaGridProps) {
  return (
    <ul className="grid grid-cols-[repeat(auto-fill,minmax(140px,1fr))] gap-3" aria-label="Tệp phương tiện">
      {items.map((item) => {
        const selected = item.name === selectedName;
        const src = item.kind === "image" ? attachmentUrl(item.name) : "";
        return (
          <li key={item.name}>
            <button
              type="button"
              aria-pressed={selected}
              title={item.displayName}
              onClick={() => onSelect(item.name)}
              className={cn(
                "flex w-full flex-col overflow-hidden rounded-[10px] border text-left transition-colors",
                selected ? "border-fg-tertiary bg-hover" : "border-hairline hover:bg-hover",
              )}
            >
              <span className="flex aspect-[4/3] w-full items-center justify-center overflow-hidden bg-subtle">
                {src ? (
                  <img src={src} alt="" loading="lazy" className="size-full object-cover" />
                ) : (
                  <span className="flex flex-col items-center gap-1">
                    <MediaIcon item={item} />
                    <span className="text-footnote font-medium uppercase text-fg-tertiary">{item.ext}</span>
                  </span>
                )}
              </span>
              <span className="block truncate px-2.5 py-2 text-footnote text-fg">{item.displayName}</span>
            </button>
          </li>
        );
      })}
    </ul>
  );
}
