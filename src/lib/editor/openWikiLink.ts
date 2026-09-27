import { api } from "../api/notes";
import { useNotesStore } from "../store/notesStore";
import { useUi } from "../store/uiStore";
import { errMsg } from "../utils";
import { normTitle } from "./wikiLinks";

// Normalized titles with a create in flight; repeat clicks are ignored.
const pending = new Set<string>();

/** Open the note titled `target` (case-insensitive), creating it if missing. */
export async function openWikiLink(target: string): Promise<void> {
  const key = normTitle(target);
  if (!key || pending.has(key)) return;
  const st = useNotesStore.getState();
  const hit = st.notes.find((n) => normTitle(n.title) === key);
  if (hit) return st.select(hit.id);
  pending.add(key);
  const toast = useUi.getState().pushToast;
  try {
    const created = await api.notes.create(target.trim(), "", []);
    useNotesStore.setState((s) => ({ notes: [created, ...s.notes] }));
    await useNotesStore.getState().select(created.id);
    toast({ message: `Đã tạo ghi chú “${created.title}”`, durationMs: 4000 });
  } catch (e) {
    toast({ message: `Không tạo được ghi chú: ${errMsg(e)}`, durationMs: 6000 });
  } finally {
    pending.delete(key);
  }
}
