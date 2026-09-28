import { describe, it, expect, beforeEach } from "vitest";
import { translate } from "./dicts";
import { useLangStore, getT } from "./store";

describe("i18n runtime", () => {
  beforeEach(() => {
    localStorage.clear();
    useLangStore.setState({ lang: "vi" });
  });

  it("translates in both languages", () => {
    expect(translate("vi", "settings.title")).toBe("Cài đặt");
    expect(translate("en", "settings.title")).toBe("Settings");
  });

  it("interpolates variables", () => {
    expect(translate("vi", "settings.trashEmptied", { n: 3 })).toBe("Đã xóa vĩnh viễn 3 ghi chú");
    expect(translate("en", "settings.trashEmptied", { n: 3 })).toBe("Permanently deleted 3 notes");
  });

  it("falls back to the key itself for unknown keys", () => {
    expect(translate("vi", "bogus.key" as never)).toBe("bogus.key");
  });

  it("setLang persists the choice and syncs <html lang>", () => {
    useLangStore.getState().setLang("en");
    expect(useLangStore.getState().lang).toBe("en");
    expect(localStorage.getItem("dnt-lang")).toBe("en");
    expect(document.documentElement.lang).toBe("en");

    useLangStore.getState().setLang("vi");
    expect(localStorage.getItem("dnt-lang")).toBe("vi");
    expect(document.documentElement.lang).toBe("vi");
  });

  it("getT reads the live language at call time", () => {
    useLangStore.setState({ lang: "en" });
    expect(getT()("settings.title")).toBe("Settings");
    useLangStore.setState({ lang: "vi" });
    expect(getT()("settings.title")).toBe("Cài đặt");
  });
});
