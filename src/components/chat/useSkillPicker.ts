import { useMemo, useState } from "react";
import { useSkillsStore } from "../../lib/store/skillsStore";
import { useUi } from "../../lib/store/uiStore";
import { skillsApi, type SkillMeta } from "../../lib/api/skills";
import { errMsg } from "../../lib/utils";
import { matchSkills } from "./queries";

export const MAX_COMPOSER_SKILLS = 3;

/** Selected skill chips + prefix-matched candidates for the active /query. */
export function useSkillPicker(query: string | null) {
  const allSkills = useSkillsStore((s) => s.skills);
  const [selected, setSelected] = useState<string[]>([]);

  const candidates: SkillMeta[] = useMemo(
    () => (query === null ? [] : matchSkills(allSkills, query, selected).slice(0, 8)),
    [query, allSkills, selected],
  );

  /** Returns false when the per-message limit is reached. */
  const add = (name: string): boolean => {
    if (selected.length >= MAX_COMPOSER_SKILLS) {
      useUi.getState().pushToast({ message: `Tối đa ${MAX_COMPOSER_SKILLS} skill mỗi tin nhắn`, durationMs: 4000 });
      return false;
    }
    setSelected((all) => (all.includes(name) ? all : [...all, name]));
    return true;
  };

  const remove = (name: string) => setSelected((all) => all.filter((x) => x !== name));

  /** Clears the selection and resolves bodies; unreadable skills are toasted and skipped. */
  const take = async (): Promise<{ name: string; body: string }[]> => {
    const names = selected;
    setSelected([]);
    const out: { name: string; body: string }[] = [];
    for (const name of names) {
      try {
        out.push({ name, body: (await skillsApi.read(name)).body });
      } catch (e) {
        useUi.getState().pushToast({ message: `Không đọc được skill ${name}: ${errMsg(e)}`, durationMs: 5000 });
      }
    }
    return out;
  };

  return { selected, candidates, add, remove, take };
}
