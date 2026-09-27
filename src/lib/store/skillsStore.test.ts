import { describe, it, expect, vi, beforeEach } from "vitest";

vi.mock("../api/skills", () => ({
  skillsApi: {
    list: vi.fn(async () => []),
    setEnabled: vi.fn(async () => {}),
    save: vi.fn(async () => {}),
    del: vi.fn(async () => {}),
  },
}));

import { skillsApi } from "../api/skills";
import { useSkillsStore, SKILL_NAME_RE } from "./skillsStore";

describe("skillsStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSkillsStore.setState({ skills: [{ name: "a", description: "", enabled: true }], loaded: true });
  });

  it("load in browser mode yields empty list without calling api", async () => {
    await useSkillsStore.getState().load();
    expect(useSkillsStore.getState().skills).toEqual([]);
    expect(skillsApi.list).not.toHaveBeenCalled();
  });

  it("toggle flips enabled and persists", async () => {
    await useSkillsStore.getState().toggle("a");
    expect(useSkillsStore.getState().skills[0].enabled).toBe(false);
    expect(skillsApi.setEnabled).toHaveBeenCalledWith("a", false);
  });

  it("toggle reverts on failure", async () => {
    vi.mocked(skillsApi.setEnabled).mockRejectedValueOnce("lỗi");
    await expect(useSkillsStore.getState().toggle("a")).rejects.toBe("lỗi");
    expect(useSkillsStore.getState().skills[0].enabled).toBe(true);
  });

  it("save upserts and remove deletes", async () => {
    await useSkillsStore.getState().save({ name: "b", description: "d", enabled: true, body: "x" });
    expect(useSkillsStore.getState().skills.map((s) => s.name)).toEqual(["a", "b"]);
    await useSkillsStore.getState().remove("a");
    expect(useSkillsStore.getState().skills.map((s) => s.name)).toEqual(["b"]);
  });

  it("validates names", () => {
    expect(SKILL_NAME_RE.test("tom-tat-1")).toBe(true);
    expect(SKILL_NAME_RE.test("Tom")).toBe(false);
    expect(SKILL_NAME_RE.test("a b")).toBe(false);
    expect(SKILL_NAME_RE.test("")).toBe(false);
  });
});
