import { useEffect } from "react";
import { Upload } from "lucide-react";
import { isTauri } from "../../lib/env";
import { filterMedia, useMediaStore } from "../../lib/store/mediaStore";
import { ContentHeader } from "../layout/ContentHeader";
import { SecondaryButton } from "../ui/Button";
import { MediaGrid } from "./MediaGrid";
import { MediaDetail } from "./MediaDetail";
import { importMediaDialog } from "./importMedia";

export function MediaLibrary() {
  const items = useMediaStore((s) => s.items);
  const loading = useMediaStore((s) => s.loading);
  const filter = useMediaStore((s) => s.filter);
  const query = useMediaStore((s) => s.query);
  const selectedName = useMediaStore((s) => s.selectedName);
  const select = useMediaStore((s) => s.select);

  useEffect(() => {
    void useMediaStore.getState().load();
  }, []);

  const visible = filterMedia(items, filter, query);
  const selected = items.find((i) => i.name === selectedName) ?? null;

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <ContentHeader
        leading={<span className="px-1 text-callout font-semibold text-fg">Media</span>}
        trailing={
          <SecondaryButton disabled={!isTauri} onClick={() => void importMediaDialog()}>
            <Upload size={13} aria-hidden="true" /> Nhập tệp…
          </SecondaryButton>
        }
      />
      <div className="flex min-h-0 flex-1">
        <div className="min-w-0 flex-1 overflow-y-auto px-5 pb-5 pt-1">
          {visible.length === 0 ? (
            <p className="pt-16 text-center text-callout text-fg-secondary">
              {loading ? "Đang tải…" : items.length === 0 ? "Chưa có tệp nào" : "Không có tệp phù hợp"}
            </p>
          ) : (
            <MediaGrid items={visible} selectedName={selectedName} onSelect={(n) => select(n)} />
          )}
        </div>
        {selected && <MediaDetail item={selected} />}
      </div>
    </main>
  );
}
