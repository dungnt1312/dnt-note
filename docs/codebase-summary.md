# DNT Note — Tóm tắt codebase

> Cập nhật: 2026-09-27 · Branch `feat/phases-5-7` (có thay đổi chưa commit)
> Liên quan: [project-overview-pdr](./project-overview-pdr.md) · [system-architecture](./system-architecture.md) · [code-standards](./code-standards.md)

## 1. Con số tổng quan (đo thực tế `wc -l`)

| Khu vực | LOC (không test) | LOC (gồm test) | Ghi chú |
|---|---:|---:|---|
| `src/components` (`.tsx`) | ~4.6k | ~5.3k | 12 file test `.test.tsx` |
| `src/lib` (`.ts`) | ~2.8k | ~4.7k | 21 file test `.test.ts` |
| `src/App.tsx` + `QuickCapture.tsx` | 265 | — | Shell + cửa sổ capture |
| `src/i18n` (area dicts) | 713 | — | 6 file dict vi/en |
| `src-tauri/src` (app crate) | ~0.9k | — | 23 Tauri commands |
| `src-tauri/crates/notes-core` | ~1.5k | — | Kèm unit test nội tuyến |
| `src-tauri/crates/mcp-server` | ~0.4k | — | Binary `dnt-note-mcp` |
| **Test** | **33 file TS** (21 lib + 12 component) | | **52 `#[test]` Rust** |

README ghi mốc: 168 TS tests + 52 Rust tests pass (số sẽ trôi khi development tiếp tục).

## 2. Cấu trúc thư mục

```
dnt-note/
├── index.html                  # lang="vi", favicon.svg, entry Vite
├── package.json                # version 0.1.0, scripts (bảng dưới)
├── vite.config.ts              # port 5273 strictPort, target es2022, plugin react + tailwind
├── vitest.config.ts / vitest.setup.ts   # jsdom, pin ngôn ngữ vi
├── tsconfig.json               # ES2022, strict
├── scripts/make-icon.mjs       # sinh bộ icon từ src-tauri/icons/dnt-note.svg (tauri icon)
├── public/                     # static assets
├── src/
│   ├── App.tsx                 # shell: Sidebar + pane + CommandPalette + Toast; shortcuts;
│   │                           # listeners deep-link dntnote://, sync://status, notes://changed
│   ├── QuickCapture.tsx        # cửa sổ capture (?quick=1): textarea, Enter lưu tag "quick"
│   ├── main.tsx                # mount React + ThemeProvider + listeners
│   ├── i18n/                   # dict theo area (vi/en parity): sidebar, notes, chat,
│   │                           # settings, app, agent (placeholder rỗng)
│   ├── components/
│   │   ├── layout/             # Sidebar.tsx (264px), CommandPalette.tsx (Ctrl+K),
│   │   │                       # ContentHeader.tsx (52px drag region), SidebarRow.tsx
│   │   ├── notes/              # NoteEditor.tsx, NoteList.tsx, NoteItem.tsx, FormatBar.tsx,
│   │   │                       # TagStrip.tsx, PrintView.tsx (?print=<id>),
│   │   │                       # EditorContextMenu.tsx, useDeleteNote.ts
│   │   ├── chat/               # ChatPanel.tsx, MessageList.tsx, ModelPicker.tsx
│   │   │   └── composer/       # Composer.tsx, ChatInput.tsx (Lexical), MentionPlugin.tsx,
│   │   │                       # ContextTokenNode.tsx (DecoratorNode), AttachmentTray.tsx
│   │   ├── settings/           # SettingsPage.tsx (4 tab), ProvidersSection.tsx,
│   │   │                       # ModelPickerDialog.tsx
│   │   ├── ui/                 # Button.tsx, Menu.tsx, ContextMenu.tsx, Dialog.tsx (Overlay),
│   │   │                       # WindowControls.tsx
│   │   ├── common/             # Toast.tsx, BrandMark.tsx (monogram D/N)
│   │   └── theme/              # ThemeProvider.tsx (light/dark/system)
│   └── lib/
│       ├── store/              # zustand: notesStore, chatStore, settingsStore,
│       │                       # composerStore, uiStore
│       ├── agent/              # engine.ts (runAgent, MAX_ITERATIONS=12), tools.ts (10 tools)
│       ├── llm/                # openai.ts (SSE client + initLlmFetch), models.ts (merge lists)
│       ├── chat/               # payload.ts (budget 8k/20k/48k), triggers.ts (@ trigger regex)
│       ├── api/                # notes.ts, chats.ts, attachments.ts, sync — invoke wrappers
│       ├── editor/             # editorSetup.ts, livePreview.ts, formatting.ts, selection.ts
│       ├── i18n/               # defineDict.ts, dicts.ts (merge + {var}), store.ts (useLangStore)
│       ├── dates.ts            # bucket thời gian kiểu ChatGPT + relative theo locale
│       ├── fuzzy.ts            # fuzzy subsequence có điểm (palette, mentions)
│       ├── filterNotes.ts      # lọc client-side theo query + tag
│       ├── openNote.ts         # parse link note://<id>, mở note từ mọi nơi
│       ├── debounce.ts         # flush/cancel cho autosave
│       ├── utils.ts            # cn() = clsx + tailwind-merge
│       └── env.ts              # isTauri guard
└── src-tauri/
    ├── tauri.conf.json         # com.dungnt.dntnote, 2 cửa sổ (main + quickcapture), csp: null
    ├── capabilities/default.json  # permissions: http https://**, store, dialog, opener…
    ├── icons/                  # icon.ico + dnt-note.svg nguồn
    ├── resources/demo/         # 4 note markdown tiếng Việt (seed lần đầu)
    ├── src/                    # app crate: main.rs, lib.rs, state.rs,
    │   └── commands/           # notes.rs (9), chats.rs (4), attachments.rs (7),
    │                           # stats.rs (1), sync.rs (2)
    └── crates/
        ├── notes-core/src/     # note.rs (frontmatter 6 trường), store.rs (NotesStore +
        │                       # write_atomic), attachments.rs, sync.rs, watcher.rs, error.rs
        └── mcp-server/src/     # binary stdio JSON-RPC: main.rs (loop), protocol methods, 7 tools
```

## 3. Tech stack

| Lớp | Công nghệ | Phiên bản |
|---|---|---|
| UI | React + react-dom | 19.2 |
| Ngôn ngữ | TypeScript (strict, ES2022) | 5.9 |
| Build | Vite + @vitejs/plugin-react | 7.1 / 5.1 |
| Styling | Tailwind CSS (`@tailwindcss/vite`, token CSS-variable) | 4.1 |
| State | zustand (persist) | 5.0.8 |
| Icons | lucide-react | 0.545 |
| Utils | clsx + tailwind-merge | — |
| Editor ghi chú | CodeMirror 6 (state/view/language/commands 6.5–6.38, lang-markdown, @lezer/*) | 6.x |
| Composer chat | Lexical + @lexical/react | 0.51 |
| Markdown render | react-markdown + remark-gfm | 10.1 / 4 |
| Desktop | Tauri (@tauri-apps/api / CLI) | 2.11.0 / 2.9.0 |
| Tauri plugins JS | http 2.7, store 2.4, dialog 2.7, opener 2.5 | — |
| Tauri plugins Rust | global-shortcut, single-instance, deep-link (`dntnote://`) | — |
| Rust app | tauri 2 (tray-icon), pdf-extract 0.9 | 2.x |
| notes-core | serde/serde_json/serde_yaml, uuid v4, chrono, thiserror 2, notify 8 + notify-debouncer-full 0.5, image 0.25, base64, zip 2 | — |
| Test | Vitest + jsdom + Testing Library React + jest-dom | 3.2 / 27 / 16.3 / 6.9 |

## 4. npm scripts

| Script | Lệnh | Mục đích |
|---|---|---|
| `dev` | `vite` | Dev server browser-only (không Tauri, dùng shim/localStorage) |
| `build` | `tsc --noEmit && vite build` | Type-check + build ra `dist/` |
| `preview` | `vite preview` | Xem thử bản build |
| `test` | `vitest run` | Chạy toàn bộ test TS một lần |
| `test:watch` | `vitest` | Watch mode |
| `tauri` | `tauri` | `npm run tauri dev` / `npm run tauri build` |

Không có script lint/format (đã ghi nhận trong [code-standards](./code-standards.md) mục nợ kỹ thuật).
Lệnh Rust chạy thủ công: `cargo test --workspace`, `cargo build -p mcp-server --release`.

## 5. Chạy test

```bash
# TypeScript (33 file: 21 lib + 12 component)
npm test                 # hoặc: npm run test:watch

# Rust (52 #[test] rải trong workspace)
cd src-tauri
cargo test --workspace   # notes-core + mcp-server + app
```

Quy ước test: xem [code-standards](./code-standards.md#testing-conventions).

## 6. Bề mặt IPC (tham khảo nhanh)

- **23 Tauri commands:** notes 9 (`list_notes`, `read_note`, `create_note`, `update_note`,
  `delete_note`, `restore_note`, `search_notes`, `list_tags`, `empty_trash`) · chats 4
  (`list_chats`, `load_chat`, `save_chat`, `delete_chat`) · attachments 7 (`attach_file`,
  `import_attachment`, `import_attachment_bytes`, `list_attachments`, `extract_attachment_text`,
  `prepare_attachment_image`, `cleanup_orphan_attachments`) · stats 1 (`get_stats`) · sync 2
  (`get_sync_folder`, `set_sync_folder`).
- **Events Rust → FE:** `notes://changed`, `notes://created`, `sync://status`,
  `quickcapture://shown`, `deep-link://url`.
- **10 agent tools** (TS-side, OpenAI function schema): xem [project-overview-pdr](./project-overview-pdr.md#5-tính-năng-chính).
- **7 MCP tools:** `list_notes` (alias `get_recent_notes`), `search_notes`, `read_note`,
  `create_note`, `update_note`, `delete_note` (soft), `open_note`.

Chi tiết kiến trúc: [system-architecture](./system-architecture.md).
