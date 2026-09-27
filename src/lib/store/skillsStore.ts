import { create } from "zustand";
import { skillsApi, type Skill, type SkillMeta } from "../api/skills";
import { isTauri } from "../env";

interface SkillsState {
  skills: SkillMeta[];
  loaded: boolean;
  load: () => Promise<void>;
  toggle: (name: string) => Promise<void>;
  save: (skill: Skill) => Promise<void>;
  remove: (name: string) => Promise<void>;
}

export const SKILL_NAME_RE = /^[a-z0-9-]{1,64}$/;

function sorted(list: SkillMeta[]): SkillMeta[] {
  return [...list].sort((a, b) => a.name.localeCompare(b.name));
}

export const useSkillsStore = create<SkillsState>()((set, get) => ({
  skills: [],
  loaded: false,

  load: async () => {
    if (!isTauri) {
      set({ skills: [], loaded: true });
      return;
    }
    try {
      set({ skills: sorted(await skillsApi.list()), loaded: true });
    } catch (e) {
      console.error("list skills failed", e);
      set({ skills: [], loaded: true });
    }
  },

  toggle: async (name) => {
    const cur = get().skills.find((s) => s.name === name);
    if (!cur) return;
    const enabled = !cur.enabled;
    const apply = (v: boolean) =>
      set((s) => ({ skills: s.skills.map((x) => (x.name === name ? { ...x, enabled: v } : x)) }));
    apply(enabled);
    try {
      await skillsApi.setEnabled(name, enabled);
    } catch (e) {
      apply(!enabled);
      throw e;
    }
  },

  save: async (skill) => {
    await skillsApi.save(skill);
    const meta = { name: skill.name, description: skill.description, enabled: skill.enabled };
    set((s) => ({ skills: sorted([...s.skills.filter((x) => x.name !== skill.name), meta]) }));
  },

  remove: async (name) => {
    await skillsApi.del(name);
    set((s) => ({ skills: s.skills.filter((x) => x.name !== name) }));
  },
}));
