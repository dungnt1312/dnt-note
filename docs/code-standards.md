# DNT Note — Cấu trúc & chuẩn code

> Cập nhật: 2026-09-27 · Áp dụng cho toàn repo (TS + Rust)
> Liên quan: [codebase-summary](./codebase-summary.md) · [system-architecture](./system-architecture.md) · [design-guidelines](./design-guidelines.md)

## 1. Quy ước tổ chức

- **Components theo feature folder:** `src/components/<feature>/` — `layout`, `notes`, `chat`
  (+ `chat/composer`), `settings`, `ui` (primitives dùng chung), `common`, `theme`.
  Primitives (`ui/`) không import ngược feature components.
- **Stores zustand** nằm `src/lib/store/` — mỗi domain 1 file, không Redux/Context:
  `notesStore` (CRUD + saveState), `chatStore` (phiên + streaming), `settingsStore` (providers),
  `composerStore` (draft chat), `uiStore` (state UI thuần).
- **API bridge wrappers** `src/lib/api/` — mọi `invoke()` của Tauri chỉ xuất hiện ở đây, trả DTO
  camelCase (`NoteMeta`, `Note`, `TagCount`, `StatsDto`, `ChatSessionDto`). Components và stores
  không gọi `invoke` trực tiếp.
- **Logic thuần tách khỏi UI:** `lib/agent`, `lib/llm`, `lib/chat`, `lib/editor`, `lib/dates`,
  `lib/fuzzy`, `lib/filterNotes` — không React, để test được bằng Vitest thuần.
- **Rust:** logic thuần ở crate `notes-core` (test tempdir); crate app chỉ giữ commands mỏng
  (`src-tauri/src/commands/<area>.rs`) + wiring (tray, shortcut, deep-link, watchers).

## 2. State management

- Component đọc state qua **selector hooks** để tránh re-render dư thừa:
  ```ts
  const query = useUi((s) => s.searchQuery);
  ```
- **Imperative cross-store** trong effects/handlers dùng `useX.getState()` (không subscribe):
  ví dụ `chatStore.getState().stopStreaming()` — components không own server state.
- Persist: `settingsStore` qua Tauri plugin-store (`providers.json`, fallback localStorage khi
  chạy browser); `composerStore` qua zustand persist (localStorage, strip data-URL);
  `useLangStore` persist `localStorage["dnt-lang"]`; theme persist localStorage.
- Chat sessions persist **qua backend** (`chats/*.json`), không qua localStorage.

## 3. i18n conventions

- Dict theo area, **enforce parity key vi/en** bằng kiểu `defineDict`:
  `src/i18n/<area>.ts` (nội dung) + `src/lib/i18n/defineDict.ts` (type) + `dicts.ts` (merge).
- Dùng `useT()` trong component, `getT` ngoài React, `localeTag()` cho ngày tháng.
- Interpolation kiểu `{var}`; fallback: vi → rồi tới key.
- Persist `localStorage["dnt-lang"]`; lần đầu detect `navigator.language`.
- ⚠️ **Nợ hiện tại:** nhiều string user-facing vẫn hardcode tiếng Việt trong `src/lib`
  (lỗi chatStore, `NEW_CHAT_TITLE`, system prompt agent, toast openNote.ts); i18n chỉ phủ UI
  chrome; dict `agent` còn placeholder rỗng. Khi chạm vào các file này cần dọn dần.

## 4. Styling

- **Tailwind v4** ánh xạ token qua `@theme` trong `src/theme/tokens.css`:
  dùng semantic utilities (`bg-app`, `text-fg`, `text-fg-tertiary`, `border-hairline`,
  `bg-composer`, `shadow-popover`, `text-callout`…) — **không inline màu hex** (ngoại lệ duy nhất
  hiện có: swatch ThemePreview và nút close đỏ của WindowControls).
- Ghép class bằng `cn()` (`clsx` + `tailwind-merge`) từ `src/lib/utils.ts`.
- Type scale cố định 11/12/13/15/17/22/28px; radii/shadow lấy từ token, không tự chế.
- Chi tiết token & a11y: [design-guidelines](./design-guidelines.md).

## 5. Editor patterns

- **CodeMirror 6** (`lib/editor/`): extension set dựng trong `editorSetup.ts`
  (lang-markdown + GFM, live preview, history, wrap, keymap Mod-b/i + heading/list, Mod-S hook,
  Studio theme); `livePreview.ts` đọc Lezer tree để decoration (heading, ẩn emphasis marks,
  widget checkbox/bullet, nhận diện frontmatter, task toggle).
- Thay đổi format là **transaction builders** thuần trong `formatting.ts`
  (`toggleWrap`, `setHeading`, `toggleLinePrefix`) — tái sử dụng được, test được.
- Context menu editor cần **selection snapshot** (`selection.ts`) vì menu mở sau khi focus đổi.
- **Lexical** (composer): chip `@note` là `ContextTokenNode` kế thừa `DecoratorNode` — atomic
  inline, non-editable, đóng góp `@label` vào plain text, serialize được vào draft JSON.
- Tauri API luôn qua `isTauri` guard + **dynamic import** `@tauri-apps/*` để app chạy được trong
  browser thuần (dev/preview).

## 6. Rust conventions

- **Ghi file luôn `write_atomic()`** (ghi `.md.tmp` rồi rename) — không ghi trực tiếp bao giờ.
- **DTO serde camelCase** khớp phía TS; field optional để tương thích ngược chat JSON cũ.
- **Error handling:** `thiserror` cho lib (`notes-core`); Tauri command trả `Result<_, String>`
  để frontend toast được.
- **Unit test đi kèm module:** mọi module Rust mới có `#[test]` nội tuyến, dùng tempdir;
  hiện 52 test trong workspace.
- Frontmatter note đúng 6 trường `id, title, tags, pinned, created, updated` (camelCase);
  field lạ bị drop khi re-serialize; CRLF normalize.
- File hỏng frontmatter → hiển thị `⚠ <filename>` + read-only, **không bao giờ tự sửa/xóa**.
- Watcher: notify-debouncer-full, debounce 300ms (notes) / 500ms (sync folder); reload store
  giữ `sync_lock`.

## 7. Testing conventions

- **Vitest + Testing Library** (jsdom); setup pin ngôn ngữ **vi** trong `vitest.setup.ts`.
- **1:1 test file cho lib:** mỗi module `src/lib/**` có `*.test.ts` cùng chỗ
  (21 lib + 12 component = 33 file).
- Test component: render + user-event, kiểm tra vai trò ARIA; mock `invoke` ở mức api bridge.
- Rust: `cargo test --workspace`, test nội tuyến cùng module (tempdir cho IO).
- Chưa có E2E/integration tự động — smoke test thủ công trước phát hành:
  xem [deployment-guide](./deployment-guide.md#5-kiểm-thử-trước-phát-hành).

## 8. Git / commit convention

Conventional commits theo git history:

| Ví dụ từ history | Ý nghĩa |
|---|---|
| `feat(composer): ZCode-style shell — tray, paperclip/@ toolbar, safe send, drop overlay` | feature theo scope |
| `fix(composer): placeholder aligns with editor text origin (drop double padding)` | bugfix |
| `feat(notes): right-click menu sends selection/note to the assistant` | feature khu notes |
| `feat(ui): cursor-anchored ContextMenu portal sharing Menu items` | primitives UI |
| `docs: implementation plan — editor right-click to assistant (6 tasks)` | docs/spec/plan |
| `phase-5: fix attachment refs…` | commit theo phase (quy ước Phase 5–7) |

- Scope gợi ý: `composer`, `chat`, `notes`, `editor`, `ui`, `settings`, `mcp`, `sync`, `docs`.
- **Ràng buộc quy trình hiện tại:** chỉ commit khi user yêu cầu (xem
  [project-roadmap](./project-roadmap.md#6-quy-trình-và-văn-bản)).

## 9. Nợ kỹ thuật đã biết

| Nợ | Vị trí | Ảnh hưởng |
|---|---|---|
| Không có script lint/format (ESLint/Prettier/rustfmt check) | `package.json` | Style phụ thuộc review tay |
| `ConfirmDialog` default cancel "Hủy" hardcode (i18n leak) | `src/components/ui/Dialog.tsx` | Dialog destructive chưa qua dict |
| Version hardcode "0.1.0" trong About | `SettingsPage.tsx` | Sai khi bump version nếu quên sửa |
| Bảng shortcuts trong Settings copy tay từ App.tsx | `SettingsPage.tsx` | Dễ drift khi thêm phím tắt |
| String hardcode tiếng Việt trong lib (xem §3) | `src/lib/**` | Chưa phủ hết i18n |
| `agentDict` placeholder rỗng | `src/i18n/agent.ts` | Chưa dùng |
| Comment ghi chú bug stacking-context | `SidebarRow.tsx` | Cần xác minh khi chỉnh z-index |
