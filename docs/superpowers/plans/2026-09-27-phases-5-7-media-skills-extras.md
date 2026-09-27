# Phase 5–7 (Media, Agent Skills, Extras) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Implement spec `docs/superpowers/specs/2026-09-27-phases-5-7-media-skills-extras-design.md`.

**Architecture:** Pure logic in `src-tauri/crates/notes-core` (unit-tested on tempdir), thin Tauri commands in `src-tauri/src/commands/<area>.rs` registered in `src-tauri/src/lib.rs`, typed invoke wrappers in `src/lib/api/`, UI in `src/components/` reusing existing `ui/` primitives, tokens and Vietnamese copy.

**Tech Stack:** Rust (Tauri 2, notes-core), React 19 + TS + zustand + CodeMirror 6, vitest, cargo test.

## Global Constraints
- Windows-first; data root `%APPDATA%\com.dungnt.dntnote` (Tauri `app_data_dir()`).
- UI copy Vietnamese; code comments English, only for non-obvious constraints.
- Commands return `Result<T, String>`; UI reports errors via `useUi.getState().pushToast`.
- Every task: `npm test`, `npm run build` (tsc+vite) and `cd src-tauri && cargo test --workspace` must pass before commit.
- Commit prefix: `phase-5:` / `phase-6:` / `phase-7:`.
- Don't break existing: 70 TS tests + 43 Rust tests.

---

## PHASE 5 — Media

### Task 1: Attachment reference fixes (parse, trash, sync)
**Files:** Modify `crates/notes-core/src/attachments.rs`, `store.rs`, `sync.rs`; `src-tauri/src/lib.rs` (do_sync passes attachments dirs).
**Produces:** `attachments::refs_in_body(&str)->Vec<String>` (balanced parens); `NotesStore::attachment_refs()` includes `.trash/*.md` and raw text of unparseable notes; `sync::mirror_attachments(local:&Path, remote:&Path)->io::Result<usize>` (copy missing files both ways, never overwrite); `attachments::cleanup_orphans(dir, refs, min_age: Duration)` only deletes files whose mtime older than `min_age` (app passes 7 days).
- [ ] Tests first: `refs_in_body("![a](attachments/x-image (1).png)\n[b](attachments/y.pdf)")== ["x-image (1).png","y.pdf"]`; traversal `(attachments/../e)` rejected; ref in trashed note kept; ref in corrupt file kept; mirror_attachments copies both directions and doesn't overwrite; cleanup_orphans with min_age skips fresh files.
- [ ] Implement: parse by scanning from `(attachments/`, depth counter starting 1, `(`→+1, `)`→-1 stop at 0, abort at `\n`.
- [ ] Wire do_sync: after `mirror`, call `mirror_attachments(app_data/attachments, sync/attachments)`.
- [ ] Verify + commit `phase-5: fix attachment refs (parens, trash), sync attachments, orphan grace period`.

### Task 2: Asset protocol + image rendering (editor, print, chat)
**Files:** `tauri.conf.json` (`app.security.assetProtocol: {enable:true, scope:["$APPDATA/com.dungnt.dntnote/attachments/**"]}`), `src-tauri/Cargo.toml` tauri feature `protocol-asset`; create `src/lib/media/attachmentUrl.ts` (+test); modify `src/lib/editor/livePreview.ts` (image block widget), `PrintView.tsx`, `components/chat/MessageList.tsx` (react-markdown `urlTransform`).
**Produces:** `initAttachmentsDir(): Promise<void>` (resolves `appDataDir()+"/attachments"` once, called in App startup + PrintView); `attachmentUrl(name:string):string`; `rewriteAttachmentSrc(url:string):string` (maps `attachments/<name>` → attachmentUrl, other urls unchanged).
- [ ] Tests: rewriteAttachmentSrc with/without dir set; livePreview spec produces `{kind:"widget", widget:"image", src}` for image line when not focused.
- [ ] Implement, verify, commit `phase-5: render attachment images via asset protocol`.

### Task 3: Media library backend
**Files:** create `crates/notes-core/src/media.rs` (register in lib.rs); create `src-tauri/src/commands/media.rs`; register commands.
**Produces (Rust):**
```rust
pub enum MediaKind { Image, Document, Audio, Other } // serde lowercase
pub struct MediaUsage { pub id: String, pub title: String }
pub struct MediaItem { name, display_name, ext, kind, size: u64, modified: DateTime<Utc>, used_by: Vec<MediaUsage> } // camelCase
pub fn kind_of(ext:&str)->MediaKind; // audio: mp3,wav,webm,m4a,ogg
pub fn display_name(stored:&str)->String; // strip "<uuid36>-" prefix
pub fn list_media(dir:&Path, store:&NotesStore)->Result<Vec<MediaItem>>; // newest first
pub fn rename_media(dir, store:&mut NotesStore, name, new_display)->Result<String>; // keeps uuid prefix, rewrites links in all notes
pub fn delete_media(dir, store:&mut NotesStore, name, force:bool)->Result<()>; // Err if used && !force; force removes md links `!?[..](attachments/name)`
```
Commands: `list_media`, `rename_media{name,newName}`, `delete_media{name,force}`, `import_media{srcPath}` (save_file only), `attach_bytes{noteId,fileName,base64}` → StoredFile (does NOT modify body; frontend inserts at cursor), `attachments_dir_path`. Add audio exts to ALLOWED_EXTENSIONS.
- [ ] Tests in media.rs for all fns (tempdir). Implement. Commit `phase-5: media library backend`.

### Task 4: Media library UI
**Files:** create `src/lib/api/media.ts`, `src/lib/store/mediaStore.ts` (+test for filter fn `filterMedia(items, filter, query)`), `src/components/media/MediaLibrary.tsx`, `MediaGrid.tsx`, `MediaDetail.tsx`; modify `uiStore.ts` (Section/Workspace add `"media"`), `Sidebar.tsx` (3rd tab "Media", Ctrl+3; sidebar body for media shows filters), `App.tsx` (render section, Ctrl+3, refresh on `notes://changed`).
Filters: `all|image|document|audio|unused`. Detail: preview (img / audio controls / icon), size, date, "Dùng trong" list (click → select note), actions Đổi tên, Chèn vào ghi chú đang mở (append link via notesStore body at end + save), Mở bằng ứng dụng khác (opener `openPath`), Xoá (ConfirmDialog; if used, second confirm "gỡ khỏi N ghi chú"). Header button "Nhập tệp…".
- [ ] Test filterMedia; implement; build; commit `phase-5: media library UI`.

### Task 5: Drag/drop & paste in editor; attach at cursor
**Files:** modify `NoteEditor.tsx`, `src/lib/editor/editorSetup.ts` (option `onFiles(files: File[], pos:number)`), create `src/lib/media/insertLink.ts` (+test `markdownLinkFor(stored:string): string` image→`![display](attachments/stored)` else `[display](attachments/stored)`).
Attach menu item uses `attach_bytes`/import then inserts at cursor (replace old append behavior: change `attach_file` usage to `import_media` + insert). Enforce max 10 refs client side.
- [ ] Test, implement, commit `phase-5: drag-drop/paste attachments into editor`.

### Task 6: Chat attachments (vision + documents) + agent media tools
**Files:** `src/lib/llm/openai.ts` (`ContentPart = {type:"text",text}|{type:"image_url",image_url:{url}}`; `ChatMessage.content: string|ContentPart[]|null`), `chatStore.ts` (`send(text, mentions, files?: ChatFileInput[])`, `ChatFileInput={name, kind:"image"|"document", dataUrl?, text?}`; `buildUserContent(text, mentions, files)` exported + tested), `Composer.tsx` (📎 button, drop, paste, chips), `MessageList.tsx` (show file chips on user msg via `UiMessage.files?: {name,kind}[]`), `agent/tools.ts` (+`list_media`, `read_attachment{name}` → extract text ≤20000 chars), `api/media.ts`.
Images: pick path → `prepare_attachment_image`; pasted blob → import_media via attach_bytes-less path: add command? Use `import_media_bytes{fileName,base64}` added in this task in commands/media.rs returning stored name, then prepare image by full path.
- [ ] Tests: buildUserContent returns string when no images, array with image_url parts when images; tools list includes new tools; executeTool read_attachment mocked.
- [ ] Commit `phase-5: chat attachments with vision + media agent tools`.

## PHASE 6 — Agent Skills

### Task 7: Skills backend + MCP
**Files:** create `crates/notes-core/src/skills.rs`; `src-tauri/resources/skills/{meeting-notes,weekly-review,flashcards}/SKILL.md`; `src-tauri/src/commands/skills.rs`; seed on startup when skills dir empty & not `skillsSeeded` in settings; tauri.conf bundle resources include `resources/skills/**`; mcp protocol add `list_skills`, `get_skill` (skills dir = notes_dir.parent()/skills).
```rust
pub struct SkillMeta { name, description, enabled: bool }
pub struct Skill { meta fields.., body: String }
pub fn parse_skill(text:&str)->Result<Skill>; // frontmatter name/description/enabled(default true)
pub fn serialize_skill(&Skill)->String;
pub fn list_skills(dir)->Vec<SkillMeta>; read_skill(dir,name); save_skill(dir,&Skill) (name must match ^[a-z0-9-]{1,64}$); delete_skill(dir,name); seed_from(src_dir,dst_dir)
```
- [ ] Tests (roundtrip, invalid name, list, delete, MCP tools/list count 9). Commit `phase-6: skills backend + MCP`.

### Task 8: Skills in agent + composer + settings
**Files:** `src/lib/api/skills.ts`, `src/lib/store/skillsStore.ts`, `agent/engine.ts` (`buildSystemPrompt(stats,id,title, skills: {name,description}[])` adds "Skills khả dụng" section + instruct to call `load_skill`), `agent/tools.ts` (`load_skill{name}`), `Composer.tsx` (`/` at start → skill autocomplete; selected skill chip; on send prepend `[Skill: name]\n<body>` into user content via chatStore `send(..., skills?)`), `components/settings/SkillsSection.tsx` (list toggle, edit dialog textarea, new, delete, open folder), SettingsPage section "Skills".
Export `slashQuery(text, caret): string|null` (tested).
- [ ] Tests: slashQuery, buildSystemPrompt includes skills, load_skill tool schema. Commit `phase-6: agent skills in chat + settings`.

## PHASE 7 — Extras

### Task 9: Version history
**Files:** create `crates/notes-core/src/history.rs`; `store.rs` update() calls `history::snapshot(dir,&old_note, force)`; `NotePatch` gains `#[serde(default)] source: Option<String>` ("agent"/"mcp" ⇒ force); MCP update sets source mcp; agent update_note/set_tags passes source "agent"; commands `list_versions{id}`, `read_version{id,version}`, `restore_version{id,version}`; UI `components/notes/HistoryDialog.tsx` from note menu.
Rules: snapshot only if body/title changed; skip if last snapshot <5min unless force; keep 50. Version id = `YYYYMMDDTHHMMSSmmmZ`.
- [ ] Tests; commit `phase-7: note version history`.

### Task 10: Wiki-links + backlinks
**Files:** `src/lib/editor/wikiLinks.ts` (+test `parseWikiLinks(text)->{from,to,target}[]`), livePreview/editorSetup integration (mark class `cm-wikilink`, Ctrl+click → select note by title; autocomplete after `[[` using @codemirror/autocomplete — add dep), `store.rs` `backlinks(id)->Vec<NoteMeta>` (notes whose body contains `[[<title>]]` case-insensitive), command `get_backlinks`, `components/notes/Backlinks.tsx` under editor, agent tool `get_backlinks{id}`.
- [ ] Tests; commit `phase-7: wiki-links and backlinks`.

### Task 11: Semantic search
**Files:** `settingsStore` provider gets optional `embeddingModel`, `transcriptionModel`; ProvidersSection inputs; `src/lib/llm/openai.ts` `embed(baseUrl,apiKey,model,inputs:string[])->number[][]`; `src/lib/semantic/index.ts` (`cosine`, `topK`, `ensureIndex` using commands `load_embeddings`/`save_embeddings` storing `embeddings.json`); tool `semantic_search{query,limit}`.
- [ ] Tests cosine/topK/stale detection; commit `phase-7: semantic search`.

### Task 12: Voice recording + transcription
**Files:** `src/lib/llm/openai.ts` `transcribe(baseUrl,apiKey,model,blob,fileName)->string` (multipart `/audio/transcriptions`); `src/components/notes/VoiceRecorder.tsx` (MediaRecorder webm, button in FormatBar/header); save via `import_media_bytes`, insert `[🎙 name](attachments/x)` + transcript blockquote. capabilities already allow http.
- [ ] Test transcribe with fetch mock; commit `phase-7: voice notes with transcription`.

### Task 13: Secure API keys
**Files:** `src-tauri/Cargo.toml` `keyring = { version = "3", features = ["windows-native"] }`; `commands/secrets.rs` `secret_set{key,value}`, `secret_get{key}->Option<String>`, `secret_delete{key}` (service "com.dungnt.dntnote"); settingsStore persists key in vault (`provider:<id>`), stores `apiKey:""` + `keyInVault:true`, migrates on load; browser fallback unchanged.
- [ ] Tests in settingsStore with mocked secrets api; commit `phase-7: store API keys in Windows Credential Manager`.

### Task 14: AI title/tag suggestions + Trash screen + docs
**Files:** `src/lib/agent/suggest.ts` (`suggestTitleAndTags(provider, title, body, existingTags) -> {title, tags}` single non-tool completion, JSON parse tolerant; tested with mock), note menu item; Rust `store.list_trash()->Vec<NoteMeta>`, `purge_trash_item(id)`, commands; `components/settings/TrashSection.tsx` in Data section; README update (features, shortcuts Ctrl+3, data layout: skills/, notes/.history/, embeddings.json).
- [ ] Tests; commit `phase-7: AI suggestions, trash screen, docs`.

## Self-review
Spec coverage: 5.0→T1, 5.1→T2, 5.2→T3/T4, 5.3→T5/T6, Phase 6→T7/T8, 7.1→T9, 7.2→T10, 7.3→T11, 7.4→T12, 7.5→T13, 7.6+docs→T14. Names consistent (`import_media_bytes` defined in T6, used T12).
