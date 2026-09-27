import { useEffect } from "react";
import { Upload } from "lucide-react";
import { isTauri } from "../../lib/env";
import { IMPORTABLE } from "../../lib/media/extensions";
import { filterMedia, useMediaStore } from "../../lib/store/mediaStore";
import { useUi } from "../../lib/store/uiStore";
import { ContentHeader } from "../layout/ContentHeader";
import { SecondaryButton } from "../ui/Button";
import { MediaGrid } from "./MediaGrid";
import { MediaDetail } from "./MediaDetail";

function errMsg(e: unknown): string {
  return typeof e === "string" ? e : e instanceof Error ? e.message : String(e);
}

export function MediaLibrary() {
  const items = useMediaStore((s) => s.items);
  const loading = useMediaStore((s) => s.loading);
  const filter = useMediaStore((s) => s.filter);
  const query = useMediaStore((s) => s.query);
  const selectedName = useMediaStore((s) => s.selectedName);
  const select = useMediaStore((s) => s.select);
  const load = useMediaStore((s) => s.load);
  const importFiles = useMediaStore((s) => s.importFiles);
  const pushToast = useUi((s) => s.pushToast);

  useEffect(() => {
    load().catch((e) => pushToast({ message: errMsg(e), durationMs: 5000 }));
  }, [load, pushToast]);

  const visible = filterMedia(items, filter, query);
  const selected = items.find((i) => i.name === selectedName) ?? null;

  const pick = async () => {
    if (!isTauri) return;
    try {
      const { open } = await import("@tauri-apps/plugin-dialog");
      const picked = await open({ multiple: true, filters: [{ name: "Tệp phương tiện", extensions: IMPORTABLE }] });
      const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
      if (paths.length === 0) return;
      const n = await importFiles(paths);
      pushToast({ message: `Đã nhập ${n} tệp`, durationMs: 3000 });
    } catch (e) {
      pushToast({ message: errMsg(e), durationMs: 5000 });
    }
  };

  return (
    <main className="flex min-w-0 flex-1 flex-col">
      <ContentHeader
        leading={<span className="px-1 text-callout font-semibold text-fg">Media</span>}
        trailing={
          <SecondaryButton disabled={!isTauri} onClick={() => void pick()}>
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
