import { useState } from "react";
import { FolderOpen, Pencil, Plus, Trash2 } from "lucide-react";
import { skillsApi, type Skill, type SkillMeta } from "../../lib/api/skills";
import { SKILL_NAME_RE, useSkillsStore } from "../../lib/store/skillsStore";
import { useUi } from "../../lib/store/uiStore";
import { isTauri } from "../../lib/env";
import { cn, errMsg } from "../../lib/utils";
import { PillButton, SecondaryButton } from "../ui/Button";
import { ConfirmDialog, Overlay } from "../ui/Dialog";

const input =
  "h-9 w-full rounded-sm border border-hairline bg-app px-3 text-callout text-fg outline-none transition-colors focus:border-fg-tertiary disabled:opacity-60";

export const SKILL_NAME_ERROR = "Tên skill chỉ gồm chữ thường a-z, số, dấu gạch ngang (tối đa 64 ký tự).";

function Toggle({ checked, label, onChange }: { checked: boolean; label: string; onChange: () => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      onClick={onChange}
      className={cn(
        "relative h-[22px] w-[38px] shrink-0 rounded-full transition-colors",
        checked ? "bg-accent" : "bg-hairline",
      )}
    >
      <span
        aria-hidden="true"
        className={cn(
          "absolute top-[2px] size-[18px] rounded-full bg-white shadow transition-[left]",
          checked ? "left-[18px]" : "left-[2px]",
        )}
      />
    </button>
  );
}

function SkillEditor({
  initial,
  isNew,
  onClose,
}: {
  initial: Skill;
  isNew: boolean;
  onClose: () => void;
}) {
  const save = useSkillsStore((s) => s.save);
  const pushToast = useUi((s) => s.pushToast);
  const [draft, setDraft] = useState<Skill>(initial);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    const name = draft.name.trim();
    if (!SKILL_NAME_RE.test(name)) {
      setError(SKILL_NAME_ERROR);
      return;
    }
    setBusy(true);
    try {
      await save({ ...draft, name, description: draft.description.trim() });
      pushToast({ message: `Đã lưu skill ${name}`, durationMs: 3000 });
      onClose();
    } catch (e) {
      pushToast({ message: errMsg(e), durationMs: 5000 });
    } finally {
      setBusy(false);
    }
  };

  return (
    <Overlay open onClose={onClose} label={isNew ? "Skill mới" : `Sửa skill ${initial.name}`} className="w-[640px]">
      <form
        className="flex flex-col gap-3 p-5"
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
      >
        <h2 className="text-headline font-semibold text-fg">{isNew ? "Skill mới" : `Sửa skill “${initial.name}”`}</h2>
        <div>
          <label htmlFor="skill-name" className="mb-1 block text-footnote font-medium text-fg-secondary">
            Tên
          </label>
          <input
            id="skill-name"
            value={draft.name}
            disabled={!isNew}
            data-autofocus={isNew ? true : undefined}
            onChange={(e) => {
              setDraft({ ...draft, name: e.target.value });
              setError(null);
            }}
            className={cn(input, "font-mono")}
            placeholder="vd: tom-tat-cuoc-hop"
            spellCheck={false}
            autoComplete="off"
          />
          {error && <p className="mt-1 text-footnote text-danger">{error}</p>}
        </div>
        <div>
          <label htmlFor="skill-desc" className="mb-1 block text-footnote font-medium text-fg-secondary">
            Mô tả
          </label>
          <input
            id="skill-desc"
            value={draft.description}
            data-autofocus={isNew ? undefined : true}
            onChange={(e) => setDraft({ ...draft, description: e.target.value })}
            className={input}
            placeholder="Khi nào trợ lý nên dùng skill này"
          />
        </div>
        <div>
          <label htmlFor="skill-body" className="mb-1 block text-footnote font-medium text-fg-secondary">
            Hướng dẫn (markdown)
          </label>
          <textarea
            id="skill-body"
            value={draft.body}
            onChange={(e) => setDraft({ ...draft, body: e.target.value })}
            className="h-[320px] w-full resize-y rounded-sm border border-hairline bg-app p-3 font-mono text-footnote text-fg outline-none focus:border-fg-tertiary"
            spellCheck={false}
          />
        </div>
        <div className="mt-1 flex justify-end gap-2">
          <SecondaryButton onClick={onClose}>Hủy</SecondaryButton>
          <PillButton type="submit" tone="accent" className="h-8 px-3.5" disabled={busy}>
            Lưu
          </PillButton>
        </div>
      </form>
    </Overlay>
  );
}

export function SkillsSection() {
  const skills = useSkillsStore((s) => s.skills);
  const toggle = useSkillsStore((s) => s.toggle);
  const remove = useSkillsStore((s) => s.remove);
  const pushToast = useUi((s) => s.pushToast);
  const [editing, setEditing] = useState<{ skill: Skill; isNew: boolean } | null>(null);
  const [deleting, setDeleting] = useState<SkillMeta | null>(null);

  const fail = (e: unknown) => pushToast({ message: errMsg(e), durationMs: 5000 });

  const openEdit = async (meta: SkillMeta) => {
    try {
      setEditing({ skill: await skillsApi.read(meta.name), isNew: false });
    } catch (e) {
      fail(e);
    }
  };

  const openFolder = async () => {
    try {
      const { openPath } = await import("@tauri-apps/plugin-opener");
      await openPath(await skillsApi.dirPath());
    } catch (e) {
      pushToast({ message: `Không mở được thư mục: ${errMsg(e)}`, durationMs: 5000 });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      {skills.length > 0 ? (
        <div className="divide-y divide-hairline overflow-hidden rounded-md border border-hairline bg-control">
          {skills.map((sk) => (
            <div key={sk.name} className="flex min-h-10 items-center gap-3 px-4 py-2.5">
              <div className="min-w-0 flex-1">
                <div className="truncate font-mono text-callout text-fg">{sk.name}</div>
                {sk.description && <div className="truncate text-footnote text-fg-secondary">{sk.description}</div>}
              </div>
              <Toggle
                checked={sk.enabled}
                label={`Bật skill ${sk.name}`}
                onChange={() => void toggle(sk.name).catch(fail)}
              />
              <SecondaryButton className="h-7 px-2.5" onClick={() => void openEdit(sk)}>
                <Pencil size={13} aria-hidden="true" /> Sửa
              </SecondaryButton>
              <SecondaryButton destructive className="h-7 px-2.5" onClick={() => setDeleting(sk)}>
                <Trash2 size={13} aria-hidden="true" /> Xoá
              </SecondaryButton>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-footnote text-fg-secondary">Chưa có skill nào.</p>
      )}
      <div className="flex gap-2">
        <SecondaryButton
          disabled={!isTauri}
          onClick={() => setEditing({ skill: { name: "", description: "", enabled: true, body: "" }, isNew: true })}
        >
          <Plus size={14} aria-hidden="true" /> Skill mới
        </SecondaryButton>
        <SecondaryButton disabled={!isTauri} onClick={() => void openFolder()}>
          <FolderOpen size={14} aria-hidden="true" /> Mở thư mục
        </SecondaryButton>
      </div>
      {editing && (
        <SkillEditor initial={editing.skill} isNew={editing.isNew} onClose={() => setEditing(null)} />
      )}
      <ConfirmDialog
        open={deleting !== null}
        title={`Xoá skill “${deleting?.name ?? ""}”?`}
        description="Thư mục skill và file SKILL.md sẽ bị xoá khỏi máy."
        confirmLabel="Xoá skill"
        onCancel={() => setDeleting(null)}
        onConfirm={() => {
          if (deleting) void remove(deleting.name).catch(fail);
          setDeleting(null);
        }}
      />
    </div>
  );
}
