import { invoke } from "@tauri-apps/api/core";

export type SkillMeta = {
  slug: string;
  name: string;
  description: string;
};

export type Skill = SkillMeta & {
  body: string;
  files: string[];
};

export type SkillWriteInput = {
  slug: string | null;
  name: string;
  description: string;
  body: string;
};

export function listSkills() {
  return invoke<SkillMeta[]>("skills_list");
}

export function readSkill(slug: string) {
  return invoke<Skill>("skill_read", { slug });
}

export function writeSkill(input: SkillWriteInput) {
  return invoke<SkillMeta>("skill_write", { input });
}

export function deleteSkill(slug: string) {
  return invoke<boolean>("skill_delete", { slug });
}
