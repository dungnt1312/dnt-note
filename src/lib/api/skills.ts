import { invoke } from "@tauri-apps/api/core";

export interface SkillMeta {
  name: string;
  description: string;
  enabled: boolean;
}

export interface Skill extends SkillMeta {
  body: string;
}

export const skillsApi = {
  list: () => invoke<SkillMeta[]>("list_skills"),
  read: (name: string) => invoke<Skill>("read_skill", { name }),
  save: (skill: Skill) => invoke<void>("save_skill", { skill }),
  del: (name: string) => invoke<void>("delete_skill", { name }),
  setEnabled: (name: string, enabled: boolean) => invoke<void>("set_skill_enabled", { name, enabled }),
  dirPath: () => invoke<string>("skills_dir_path"),
};
