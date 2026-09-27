import { isTauri } from "../../lib/env";
import { IMPORTABLE } from "../../lib/media/extensions";
import { useMediaStore } from "../../lib/store/mediaStore";
import { useUi } from "../../lib/store/uiStore";
import { errMsg } from "../../lib/utils";

/** Pick files with the native dialog and import them into the media library. */
export async function importMediaDialog(): Promise<void> {
  if (!isTauri) return;
  const { pushToast } = useUi.getState();
  try {
    const { open } = await import("@tauri-apps/plugin-dialog");
    const picked = await open({ multiple: true, filters: [{ name: "Tệp phương tiện", extensions: IMPORTABLE }] });
    const paths = picked === null ? [] : Array.isArray(picked) ? picked : [picked];
    if (paths.length === 0) return;
    const r = await useMediaStore.getState().importFiles(paths);
    const msg = `Đã nhập ${r.imported}/${r.total} tệp`;
    pushToast({ message: r.firstError ? `${msg} · ${r.firstError}` : msg, durationMs: r.firstError ? 6000 : 3000 });
  } catch (e) {
    pushToast({ message: errMsg(e), durationMs: 5000 });
  }
}
