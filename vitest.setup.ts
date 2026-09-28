import "@testing-library/jest-dom/vitest";
import { useLangStore } from "./src/lib/i18n/store";

// UI strings in test assertions are Vietnamese — pin the language for every test file
// (the store would otherwise default from navigator.language, which is en-US in jsdom).
useLangStore.setState({ lang: "vi" });
