# Chat Composer Refactor Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild the chat composer on the ZCode model — Lexical editor with inline `@note` tokens, an attachment tray (paperclip/paste/drag-drop), safe send, message-bound retry, and structured persistence — per `docs/superpowers/specs/2026-09-27-composer-refactor-design.md`.

**Architecture:** Lexical (`lexical` + `@lexical/react` 0.51) replaces the textarea; mentions become atomic `ContextTokenNode` decorator nodes; attachments live in a persisted per-chat `composerStore`; `chatStore.send` validates before mutating and owns per-run abort controllers; Rust gains import-only attachment commands and chat-JSON metadata (mentions/attachments/error) with orphan-cleanup awareness.

**Tech Stack:** React 19, Zustand 5 (persist), Lexical 0.51, Tauri 2 (Rust), Vitest + Testing Library, cargo test.

## Global Constraints

- UI copy in Vietnamese; reuse existing theme tokens (`bg-composer`, `border-composer-border`, `bg-popover`, `bg-accent`, `text-fg-secondary`, …).
- Tauri commands return `Result<T, String>`; errors use the `attachment-error: ` prefix where existing code does.
- Gates per task: `npm test` (all TS), `npm run build`, `cargo test --workspace` must pass at the end of every task.
- Existing tests are adapted, not deleted, when signatures change (`send(text, mentions)` → `send(payload)`).
- File limits: allowlist + 25 MiB (Rust, unchanged); image edge 2048px (unchanged); mention 8,000 chars/note; document 20,000 chars; total hidden context 48,000 chars.
- No new ZCode categories (skills UI, plugins, agents), no queueing, no history images.

---

### Task 1: Rust — chat message metadata + attachment-aware orphan cleanup

**Files:**
- Modify: `src-tauri/src/commands/chats.rs`
- Modify: `src-tauri/src/lib.rs` (startup cleanup block, ~lines 145–156)
- Modify: `src-tauri/src/commands/attachments.rs` (`cleanup_orphan_attachments`)

**Interfaces:**
- Produces (Rust DTO): `ChatMessage` gains `mentions: Option<Vec<ChatMention>>`, `attachments: Option<Vec<ChatAttachment>>`, `error: Option<String>` (all `skip_serializing_if = "Option::is_none"`, `#[serde(default)]`); `ChatMention { id: String, title: String }`, `ChatAttachment { id: String, name: String, original_name: String, size: u64, kind: String }` — camelCase on the wire (`originalName`).
- Produces: `pub fn attachment_names_from_json(raw: &str) -> Vec<String>` (pure) and `pub fn chats_attachment_names(app: &tauri::AppHandle) -> Vec<String>` in `commands::chats`.

- [ ] **Step 1: Write failing tests** — extend `mod tests` in `chats.rs`:

```rust
#[test]
fn chat_message_metadata_round_trip() {
    let mut m = ChatMessage {
        role: "user".into(),
        content: "phân tích giúp".into(),
        tool_calls: None,
        tool_call_id: None,
        name: None,
        error: Some("LLM 500: boom".into()),
        mentions: Some(vec![ChatMention { id: "n1".into(), title: "Roadmap".into() }]),
        attachments: Some(vec![ChatAttachment {
            id: "a1".into(),
            name: "uuid-x.png".into(),
            original_name: "x.png".into(),
            size: 12,
            kind: "image".into(),
        }]),
    };
    let raw = serde_json::to_string(&m).unwrap();
    assert!(raw.contains("\"originalName\""));
    assert_eq!(serde_json::from_str::<ChatMessage>(&raw).unwrap(), m);
    m.mentions = None;
    m.attachments = None;
    m.error = None;
    let raw = serde_json::to_string(&m).unwrap();
    assert!(!raw.contains("mentions") && !raw.contains("attachments") && !raw.contains("error"));
}

#[test]
fn old_chat_json_still_parses() {
    let raw = r#"{"role":"user","content":"hi"}"#;
    let m: ChatMessage = serde_json::from_str(raw).unwrap();
    assert_eq!(m.content, "hi");
    assert!(m.mentions.is_none() && m.attachments.is_none() && m.error.is_none());
}

#[test]
fn attachment_names_from_chat_json() {
    let raw = r#"{"id":"c1","title":"t","updated":"x","messages":[
        {"role":"user","content":"x","attachments":[{"id":"a","name":"f1.png","originalName":"f.png","size":1,"kind":"image"}]},
        {"role":"assistant","content":"y"}]}"#;
    assert_eq!(attachment_names_from_json(raw), vec!["f1.png".to_string()]);
    assert!(attachment_names_from_json("not json").is_empty());
}
```

- [ ] **Step 2: Run** `cargo test -p dnt-note chats` — expect compile FAIL (fields/`ChatMention`/fns missing).

- [ ] **Step 3: Implement** — extend the DTO and add the helpers:

```rust
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatMention {
    pub id: String,
    pub title: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ChatAttachment {
    pub id: String,
    /// Stored (uuid-prefixed) file name inside attachments/.
    pub name: String,
    pub original_name: String,
    pub size: u64,
    pub kind: String, // "image" | "document"
}
```

Add to `ChatMessage` (after `name`):

```rust
#[serde(default, skip_serializing_if = "Option::is_none")]
pub mentions: Option<Vec<ChatMention>>,
#[serde(default, skip_serializing_if = "Option::is_none")]
pub attachments: Option<Vec<ChatAttachment>>,
#[serde(default, skip_serializing_if = "Option::is_none")]
pub error: Option<String>,
```

Update the `session()` test helper to construct with the new `None` fields. Helpers:

```rust
/// Attachment names referenced by one chat-session JSON (robust to old files).
pub fn attachment_names_from_json(raw: &str) -> Vec<String> {
    let Ok(v) = serde_json::from_str::<serde_json::Value>(raw) else { return Vec::new(); };
    let Some(messages) = v.get("messages").and_then(|m| m.as_array()) else { return Vec::new(); };
    let mut out = Vec::new();
    for msg in messages {
        if let Some(arr) = msg.get("attachments").and_then(|a| a.as_array()) {
            for att in arr {
                if let Some(name) = att.get("name").and_then(|n| n.as_str()) {
                    out.push(name.to_string());
                }
            }
        }
    }
    out
}

/// Attachment names referenced by any saved chat session.
pub fn chats_attachment_names(app: &tauri::AppHandle) -> Vec<String> {
    let dir = app.path().app_data_dir().ok().map(|d| d.join("chats"));
    let Some(dir) = dir else { return Vec::new(); };
    let Ok(entries) = std::fs::read_dir(&dir) else { return Vec::new(); };
    let mut out = Vec::new();
    for entry in entries.flatten() {
        let path = entry.path();
        if path.extension().and_then(|e| e.to_str()) != Some("json") { continue; }
        if let Ok(raw) = std::fs::read_to_string(&path) {
            out.extend(attachment_names_from_json(&raw));
        }
    }
    out
}
```

- [ ] **Step 4: Wire cleanup** — in `lib.rs` startup block change `let refs = notes_store.attachment_refs();` to:

```rust
let mut refs = notes_store.attachment_refs();
// Chat-attached files must survive orphan cleanup too.
if let Some(h) = app_handle_opt.as_ref() { /* pass &handle here */ }
```

Concretely: the setup closure has `handle` (`tauri::AppHandle`) in scope — add `refs.extend(commands::chats::chats_attachment_names(&handle));` right after `attachment_refs()`. In `commands/attachments.rs::cleanup_orphan_attachments`, same extension before `cleanup_orphans`:

```rust
let mut refs = state.store.lock().map_err(err_of)?.attachment_refs();
refs.extend(crate::commands::chats::chats_attachment_names(&app));
```

- [ ] **Step 5:** `cargo test --workspace` → PASS. `git add -A && git commit -m "rust: chat message metadata (mentions/attachments/error) + chat-aware orphan cleanup"`

---

### Task 2: Rust — import-only attachment commands + relative-name resolution

**Files:**
- Modify: `src-tauri/crates/notes-core/src/attachments.rs` (`save_bytes` + tests)
- Modify: `src-tauri/src/commands/attachments.rs` (new commands, `StoredFile.path`, resolve helper)
- Modify: `src-tauri/src/lib.rs` (register `import_attachment`, `import_attachment_bytes`)

**Interfaces:**
- Produces (Rust): `import_attachment(app, src_path: String) -> StoredFile`; `import_attachment_bytes(app, file_name: String, bytes: Vec<u8>) -> StoredFile`; `StoredFile { name, size, path }` (`path` = absolute stored path, camelCase-safe). `extract_attachment_text` / `prepare_attachment_image` gain `app: tauri::AppHandle` and resolve relative inputs against `attachments/`.
- Produces (core): `notes_core::attachments::save_bytes(dir: &Path, file_name: &str, bytes: &[u8]) -> Result<String>`.

- [ ] **Step 1: Failing core tests** in `notes-core/src/attachments.rs` `mod tests`:

```rust
#[test]
fn save_bytes_round_trip_and_name() {
    let dir = std::env::temp_dir().join(format!("att-bytes-{}", uuid::Uuid::new_v4());
    let stored = save_bytes(&dir, "slide deck.pdf", b"pdf-bytes").unwrap();
    assert!(stored.ends_with("-slide deck.pdf"));
    assert_eq!(std::fs::read(dir.join(&stored)).unwrap(), b"pdf-bytes");
}

#[test]
fn save_bytes_rejects_bad_input() {
    let dir = std::env::temp_dir();
    assert!(save_bytes(&dir, "virus.exe", b"x").is_err());        // extension allowlist
    assert!(save_bytes(&dir, "../escape.png", b"x").is_err());    // no path separators
    assert!(save_bytes(&dir, "", b"x").is_err());                 // empty name
    let big = vec![0u8; (MAX_FILE_BYTES + 1) as usize];
    assert!(save_bytes(&dir, "big.png", &big).is_err());          // size cap
}
```

(Trim the temp-dir comment noise; fix the intentional paren typo when typing for real.)

- [ ] **Step 2:** `cargo test -p notes-core save_bytes` → FAIL (missing fn).

- [ ] **Step 3: Implement `save_bytes`** next to `save_file`:

```rust
/// Write raw bytes into the attachments dir as `<uuid>-<file_name>` (paste/drop path).
pub fn save_bytes(attachments_dir: &Path, file_name: &str, bytes: &[u8]) -> Result<String> {
    let clean = Path::new(file_name);
    if file_name.is_empty()
        || file_name.contains('/')
        || file_name.contains('\\')
        || clean.file_name().and_then(|n| n.to_str()) != Some(file_name)
    {
        return Err(NoteError::Unknown("Tên file không hợp lệ".into()));
    }
    if !is_allowed(clean) {
        return Err(NoteError::Unknown(format!(
            "Định dạng không hỗ trợ: {}",
            clean.extension().and_then(|e| e.to_str()).unwrap_or("?")
        )));
    }
    if bytes.len() as u64 > MAX_FILE_BYTES {
        return Err(NoteError::Unknown(format!(
            "File quá lớn ({:.1}MB, giới hạn 25MB)",
            bytes.len() as f64 / (1024.0 * 1024.0)
        )));
    }
    let stored = format!("{}-{}", uuid::Uuid::new_v4(), file_name);
    fs::create_dir_all(attachments_dir)?;
    fs::write(attachments_dir.join(&stored), bytes)?;
    Ok(stored)
}
```

- [ ] **Step 4: Commands** — in `commands/attachments.rs` add `path` to `StoredFile` (`pub path: String`), update `attach_file`'s final `Ok(StoredFile { name: stored_name, size, path: dir.join(&stored_name).to_string_lossy().into_owned() })`, and add:

```rust
/// Resolve a user-provided path: absolute → as-is, bare name → inside attachments/.
fn resolve_attachment_path(app: &tauri::AppHandle, input: &str) -> CmdResult<PathBuf> {
    let p = PathBuf::from(input);
    if p.is_absolute() { Ok(p) } else { attachments_dir(app)?.join(p) }
}

/// Copy a file into attachments/ WITHOUT touching any note (chat composer).
#[tauri::command]
pub fn import_attachment(app: tauri::AppHandle, src_path: String) -> CmdResult<StoredFile> {
    let dir = attachments_dir(&app)?;
    let stored_name = attachments::save_file(&dir, &PathBuf::from(&src_path)).map_err(err_of)?;
    let path = dir.join(&stored_name);
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    Ok(StoredFile { name: stored_name, size, path: path.to_string_lossy().into_owned() })
}

/// Import raw bytes (clipboard paste / drag-drop File) into attachments/.
#[tauri::command]
pub fn import_attachment_bytes(app: tauri::AppHandle, file_name: String, bytes: Vec<u8>) -> CmdResult<StoredFile> {
    let dir = attachments_dir(&app)?;
    let stored_name = attachments::save_bytes(&dir, &file_name, &bytes).map_err(err_of)?;
    let path = dir.join(&stored_name);
    let size = std::fs::metadata(&path).map(|m| m.len()).unwrap_or(0);
    Ok(StoredFile { name: stored_name, size, path: path.to_string_lossy().into_owned() })
}
```

Change `extract_attachment_text(app: tauri::AppHandle, path: String)` and `prepare_attachment_image(app: tauri::AppHandle, path: String)` to resolve via `resolve_attachment_path(&app, &path)?` before use. Register both new commands in `lib.rs` `invoke_handler` (after `attach_file`).

- [ ] **Step 5:** `cargo test --workspace` → PASS (old command tests untouched — no existing callers of extract/prepare). Commit: `rust: import_attachment(+bytes) commands, StoredFile.path, relative-name resolution`

---

### Task 3: TS — content parts, pure payload/trigger builders

**Files:**
- Modify: `src/lib/llm/openai.ts` (`ChatMessage.content` widens)
- Create: `src/lib/chat/payload.ts`, Test: `src/lib/chat/payload.test.ts`
- Create: `src/lib/chat/triggers.ts`, Test: `src/lib/chat/triggers.test.ts`

**Interfaces:**
- Produces: `ContentPart` type in `openai.ts`; in `payload.ts`: `MentionInput { id; title; body; failed? }`, `AttachmentInput { id; name; originalName; size; kind: "image"|"document"; text?; previewUrl? }`, `MAX_CONTEXT_CHARS=8000`, `MAX_DOC_CHARS=20000`, `MAX_TOTAL_CONTEXT_CHARS=48000`, `buildUserContent(text, mentions, docs): string`, `buildRequestUserMessage(text, mentions, attachments): ChatMessage`; in `triggers.ts`: `activeTriggerQuery(textBeforeCaret: string): string | null`.

- [ ] **Step 1: Failing tests** — `triggers.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { activeTriggerQuery } from "./triggers";

describe("activeTriggerQuery", () => {
  it.each([
    ["@ro", "ro"], ["gọi tới @", ""], ["(@note", "note"], ["— @roadmap", "roadmap"],
    ["start\n@", ""], ["đánh giá @Hồ sơ", "Hồ sơ"],
  ])("%j → %j", (input, expected) => expect(activeTriggerQuery(input)).toBe(expected));

  it.each(["user@host", "a@b", "x_@y"])("%s does not trigger", (input) =>
    expect(activeTriggerQuery(input)).toBeNull());

  it("query ends at whitespace or another @", () => {
    expect(activeTriggerQuery("@road map")).toBeNull();       // caret before " map"
    expect(activeTriggerQuery("@one @tw", )).toBe("tw");      // second trigger wins
  });
});
```

(Fix the stray comma when writing for real.) `payload.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { buildRequestUserMessage, buildUserContent, MAX_DOC_CHARS } from "./payload";

const m = (id: string, body: string, failed = false) => ({ id, title: `T-${id}`, body, failed });

describe("buildUserContent", () => {
  it("appends mention blocks with title header", () => {
    const out = buildUserContent("hỏi", [m("n1", "nội dung")], []);
    expect(out).toBe("hỏi\n\n[@T-n1]\n---\nnội dung");
  });
  it("marks failed reads instead of sending empty body", () => {
    const out = buildUserContent("q", [m("n1", "", true)], []);
    expect(out).toContain("(không đọc được ghi chú)");
  });
  it("truncates one mention to 8000 and whole context to 48000", () => {
    const big = "x".repeat(10_000);
    expect(buildUserContent("q", [m("n1", big)], [])).toContain("…");
    const many = Array.from({ length: 8 }, (_, i) => m(`n${i}`, big));
    const out = buildUserContent("q", many, []);
    expect(out.length).toBeLessThan(49_000);
    expect(out).toContain("đã lược bỏ");
  });
  it("appends document text blocks", () => {
    const doc = { id: "a", name: "f.pdf", originalName: "f.pdf", size: 1, kind: "document" as const, text: "abc" };
    const out = buildUserContent("q", [], [doc]);
    expect(out).toContain("[File: f.pdf]\n---\nabc");
  });
});

describe("buildRequestUserMessage", () => {
  const img = (id: string) => ({ id, name: `${id}.png`, originalName: `${id}.png`, size: 1, kind: "image" as const, previewUrl: `data:image/png;base64,${id}` });
  it("keeps plain string content when no images", () => {
    const msg = buildRequestUserMessage("q", [], [{ id: "d", name: "d.pdf", originalName: "d.pdf", size: 1, kind: "document", text: "t" }]);
    expect(msg.content).toBeTypeOf("string");
  });
  it("builds OpenAI parts when images present", () => {
    const msg = buildRequestUserMessage("q", [], [img("i1"), img("i2")]);
    expect(Array.isArray(msg.content)).toBe(true);
    const parts = msg.content as Array<{ type: string; image_url?: { url: string } }>;
    expect(parts[0].type).toBe("text");
    expect(parts.filter((p) => p.type === "image_url")).toHaveLength(2);
    expect(parts[1].image_url?.url).toContain("i1");
  });
  it("caps document text at MAX_DOC_CHARS", () => {
    const doc = { id: "d", name: "d.txt", originalName: "d.txt", size: 1, kind: "document" as const, text: "y".repeat(MAX_DOC_CHARS + 500) };
    expect(buildUserContent("q", [], [doc])).toHaveLength("q".length + "\n\n[File: d.txt]\n---\n".length + MAX_DOC_CHARS + 1);
  });
});
```

- [ ] **Step 2:** `npm test -- src/lib/chat` → FAIL (modules missing).

- [ ] **Step 3: Implement.** `openai.ts`:

```ts
export type ContentPart =
  | { type: "text"; text: string }
  | { type: "image_url"; image_url: { url: string } };

export interface ChatMessage {
  role: "system" | "user" | "assistant" | "tool";
  content: string | ContentPart[] | null;
  /* …unchanged tool_calls/tool_call_id/name… */
}
```

`triggers.ts`:

```ts
/** Active "@query" before the caret; `@` only when not glued to a word char. */
export function activeTriggerQuery(textBeforeCaret: string): string | null {
  const m = /(?:^|[^A-Za-z0-9_])@([^\s@]*)$/.exec(textBeforeCaret);
  return m ? m[1] : null;
}
```

`payload.ts`:

```ts
import type { ChatMessage, ContentPart } from "../llm/openai";

export const MAX_CONTEXT_CHARS = 8000;
export const MAX_DOC_CHARS = 20000;
export const MAX_TOTAL_CONTEXT_CHARS = 48000;

export interface MentionInput { id: string; title: string; body: string; failed?: boolean }
export interface AttachmentInput {
  id: string; name: string; originalName: string; size: number;
  kind: "image" | "document"; text?: string; previewUrl?: string;
}

function clip(text: string, max: number, budget: number): { body: string; truncated: boolean } {
  const limit = Math.min(max, Math.max(0, budget));
  return { body: text.slice(0, limit), truncated: text.length > limit };
}

/** Visible text + hidden context blocks (mentions and document extracts). */
export function buildUserContent(text: string, mentions: MentionInput[], docs: AttachmentInput[]): string {
  let out = text;
  let budget = MAX_TOTAL_CONTEXT_CHARS;
  const block = (header: string, body: string) => `\n\n${header}\n---\n${body}`;
  for (const m of mentions) {
    const header = `[@${m.title}]`;
    if (m.failed) { out += block(header, "(không đọc được ghi chú)"); continue; }
    const { body, truncated } = clip(m.body, MAX_CONTEXT_CHARS, budget);
    budget -= body.length;
    out += block(header, truncated ? `${body}…` : body || "(trống)");
  }
  for (const d of docs) {
    const header = `[File: ${d.originalName}]`;
    const { body, truncated } = clip(d.text ?? "", MAX_DOC_CHARS, budget);
    budget -= body.length;
    out += block(header, body ? (truncated ? `${body}…` : body) : "(không đọc được nội dung file)");
  }
  if (budget <= 0) out += "\n\n(một phần ngữ cảnh đã lược bỏ do vượt giới hạn)";
  return out;
}

/** Wire user message: plain string, or OpenAI parts when images are attached. */
export function buildRequestUserMessage(
  text: string,
  mentions: MentionInput[],
  attachments: AttachmentInput[],
): ChatMessage {
  const docs = attachments.filter((a) => a.kind === "document" && a.text);
  const content = buildUserContent(text, mentions, docs);
  const images = attachments.filter((a) => a.kind === "image" && a.previewUrl);
  if (images.length === 0) return { role: "user", content };
  const parts: ContentPart[] = [
    { type: "text", text: content },
    ...images.map((a) => ({ type: "image_url" as const, image_url: { url: a.previewUrl! } })),
  ];
  return { role: "user", content: parts };
}
```

Note: `budget <= 0` note appended once even mid-list — acceptable per spec ("truncate the last block and note the truncation"); test asserts `đã lược bỏ` presence only.

- [ ] **Step 4:** `npm test` → all pass (type widening is backward compatible). Commit: `feat(llm): content parts + payload/trigger builders (pure)`

---

### Task 4: TS — api wrappers + composerStore (drafts, attachment pipeline)

**Files:**
- Modify: `src/lib/api/attachments.ts`
- Create: `src/lib/store/composerStore.ts`, Test: `src/lib/store/composerStore.test.ts`

**Interfaces:**
- Consumes: Task 2 commands (`import_attachment`, `import_attachment_bytes`, relative-name `prepare_attachment_image` / `extract_attachment_text`), Task 3 `MAX_DOC_CHARS`.
- Produces: `attachmentsApi.importFile(srcPath) => Promise<StoredFile & { path: string }>`, `attachmentsApi.importBytes(fileName, bytes) => Promise<StoredFile & { path: string }>`; store:

```ts
export interface DraftAttachment {
  id: string; name: string; originalName: string; size: number;
  kind: "image" | "document"; status: "importing" | "ready" | "error";
  error?: string; text?: string; previewUrl?: string;
}
export interface ComposerDraft { editorJson: string | null; text: string; attachments: DraftAttachment[] }
export const useComposerStore: {
  drafts: Record<string, ComposerDraft>;
  setEditorState(chatId: string, editorJson: string | null, text: string): void;
  addAttachmentFiles(chatId: string, files: File[]): Promise<void>;
  addAttachmentPaths(chatId: string, paths: string[]): Promise<void>;
  removeAttachment(chatId: string, id: string): void;
  clearDraft(chatId: string): void;
};
export function stripForPersist(drafts: Record<string, ComposerDraft>): Record<string, ComposerDraft>;
```

- [ ] **Step 1: Extend `attachments.ts`** (StoredFile gains `path`):

```ts
export interface StoredFile { name: string; size: number; path: string }
// inside attachmentsApi:
importFile: (srcPath: string) => invoke<StoredFile>("import_attachment", { srcPath }),
importBytes: (fileName: string, bytes: Uint8Array) =>
  invoke<StoredFile>("import_attachment_bytes", { fileName, bytes: Array.from(bytes) }),
```

- [ ] **Step 2: Failing store tests** — `composerStore.test.ts` (mock Tauri core):

```ts
import { beforeEach, describe, expect, it, vi } from "vitest";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));

import { stripForPersist, useComposerStore, IMAGE_EXTENSIONS } from "./composerStore";

const png = new File([new Uint8Array([1, 2, 3])], "ảnh.png", { type: "image/png" });

beforeEach(() => {
  invoke.mockReset();
  useComposerStore.setState({ drafts: {} });
});

describe("composerStore attachments", () => {
  it("imports bytes → ready image with preview + kind image", async () => {
    invoke.mockImplementationOnce(() => Promise.resolve({ name: "uuid-ảnh.png", size: 3, path: "C:/att/uuid-ảnh.png" }))
      .mockImplementationOnce(() => Promise.resolve("data:image/png;base64,AAA"));
    await useComposerStore.getState().addAttachmentFiles("c1", [png]);
    const a = useComposerStore.getState().drafts.c1.attachments[0];
    expect(a.status).toBe("ready");
    expect(a.kind).toBe("image");
    expect(a.previewUrl).toContain("data:image/png");
    expect(a.originalName).toBe("ảnh.png");
  });

  it("documents get extracted text capped", async () => {
    invoke.mockImplementationOnce(() => Promise.resolve({ name: "u.pdf", size: 9, path: "C:/att/u.pdf" }))
      .mockImplementationOnce(() => Promise.resolve("x".repeat(30_000)));
    await useComposerStore.getState().addAttachmentFiles("c1", [new File([new Uint8Array(9)], "a.pdf")]);
    const a = useComposerStore.getState().drafts.c1.attachments[0];
    expect(a.kind).toBe("document");
    expect(a.text).toHaveLength(20_000);
  });

  it("import failure → status error with message, other items unaffected", async () => {
    invoke.mockRejectedValueOnce(new Error("attachment-error: Định dạng không hỗ trợ: exe"));
    await useComposerStore.getState().addAttachmentFiles("c1", [new File([new Uint8Array(1)], "x.exe")]);
    const a = useComposerStore.getState().drafts.c1.attachments[0];
    expect(a.status).toBe("error");
    expect(a.error).toContain("không hỗ trợ");
  });

  it("paths import via importFile and drafts are per-chat", async () => {
    invoke.mockResolvedValue({ name: "u.png", size: 1, path: "C:/att/u.png" });
    await useComposerStore.getState().addAttachmentPaths("c1", ["C:/Users/me/u.png"]);
    await useComposerStore.getState().addAttachmentPaths("c2", ["C:/Users/me/v.png"]);
    const d = useComposerStore.getState().drafts;
    expect(d.c1.attachments).toHaveLength(1);
    expect(d.c2.attachments).toHaveLength(1);
    expect(invoke).toHaveBeenCalledWith("import_attachment", expect.anything());
  });

  it("removeAttachment and clearDraft", async () => {
    invoke.mockResolvedValue({ name: "u.png", size: 1, path: "p" });
    await useComposerStore.getState().addAttachmentPaths("c1", ["C:/u.png"]);
    useComposerStore.getState().removeAttachment("c1", useComposerStore.getState().drafts.c1.attachments[0].id);
    expect(useComposerStore.getState().drafts.c1.attachments).toHaveLength(0);
    useComposerStore.getState().setEditorState("c1", "{}", "hi");
    useComposerStore.getState().clearDraft("c1");
    expect(useComposerStore.getState().drafts.c1).toBeUndefined();
  });

  it("stripForPersist drops previewUrl and importing items", () => {
    const out = stripForPersist({
      c1: {
        editorJson: "{}", text: "t",
        attachments: [
          { id: "a", name: "n", originalName: "n", size: 1, kind: "image", status: "ready", previewUrl: "data:…" },
          { id: "b", name: "m", originalName: "m", size: 1, kind: "image", status: "importing" },
        ],
      },
    });
    const atts = out.c1.attachments;
    expect(atts).toHaveLength(1);
    expect(atts[0].previewUrl).toBeUndefined();
  });
});
```

- [ ] **Step 3:** `npm test -- composerStore` → FAIL.

- [ ] **Step 4: Implement** `composerStore.ts`:

```ts
import { create } from "zustand";
import { persist } from "zustand/middleware";
import { attachmentsApi } from "../api/attachments";
import { MAX_DOC_CHARS } from "../chat/payload";

export const IMAGE_EXTENSIONS = ["png", "jpg", "jpeg", "gif", "webp", "bmp"];

export interface DraftAttachment {
  id: string; name: string; originalName: string; size: number;
  kind: "image" | "document"; status: "importing" | "ready" | "error";
  error?: string; text?: string; previewUrl?: string;
}
export interface ComposerDraft { editorJson: string | null; text: string; attachments: DraftAttachment[] }

const newId = () => `a_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
const ext = (name: string) => name.split(".").pop()?.toLowerCase() ?? "";
const kindOf = (name: string): DraftAttachment["kind"] =>
  IMAGE_EXTENSIONS.includes(ext(name)) ? "image" : "document";

interface ComposerState {
  drafts: Record<string, ComposerDraft>;
  setEditorState: (chatId: string, editorJson: string | null, text: string) => void;
  addAttachmentFiles: (chatId: string, files: File[]) => Promise<void>;
  addAttachmentPaths: (chatId: string, paths: string[]) => Promise<void>;
  removeAttachment: (chatId: string, id: string) => void;
  clearDraft: (chatId: string) => void;
}

/** localStorage-safe view: no data URLs, no in-flight items. */
export function stripForPersist(drafts: Record<string, ComposerDraft>): Record<string, ComposerDraft> {
  const out: Record<string, ComposerDraft> = {};
  for (const [chatId, d] of Object.entries(drafts)) {
    const attachments = d.attachments
      .filter((a) => a.status !== "importing")
      .map(({ previewUrl: _drop, ...rest }) => rest);
    if (!d.text && !d.editorJson && attachments.length === 0) continue;
    out[chatId] = { editorJson: d.editorJson, text: d.text, attachments };
  }
  return out;
}

export const useComposerStore = create<ComposerState>()(
  persist(
    (set, get) => {
      const draft = (chatId: string): ComposerDraft => {
        const existing = get().drafts[chatId];
        if (existing) return existing;
        const fresh: ComposerDraft = { editorJson: null, text: "", attachments: [] };
        set((s) => ({ drafts: { ...s.drafts, [chatId]: fresh } }));
        return fresh;
      };
      const patch = (chatId: string, fn: (d: ComposerDraft) => ComposerDraft) =>
        set((s) => ({ drafts: { ...s.drafts, [chatId]: fn(s.drafts[chatId] ?? { editorJson: null, text: "", attachments: [] }) } }));
      const hydrate = async (chatId: string, id: string, stored: { name: string; size: number; path: string }, originalName: string) => {
        const kind = kindOf(originalName);
        try {
          if (kind === "image") {
            const previewUrl = await attachmentsApi.prepareImage(stored.path);
            patch(chatId, (d) => ({ ...d, attachments: d.attachments.map((a) => (a.id === id ? { ...a, name: stored.name, size: stored.size, kind, status: "ready", previewUrl } : a)) }));
          } else {
            const raw = await attachmentsApi.extractText(stored.path);
            patch(chatId, (d) => ({ ...d, attachments: d.attachments.map((a) => (a.id === id ? { ...a, name: stored.name, size: stored.size, kind, status: "ready", text: raw.slice(0, MAX_DOC_CHARS) } : a)) }));
          }
        } catch (e) {
          const error = e instanceof Error ? e.message : String(e);
          patch(chatId, (d) => ({ ...d, attachments: d.attachments.map((a) => (a.id === id ? { ...a, status: "error", error } : a)) }));
        }
      };
      return {
        drafts: {},
        setEditorState: (chatId, editorJson, text) => patch(chatId, (d) => ({ ...d, editorJson, text })),
        addAttachmentFiles: async (chatId, files) => {
          draft(chatId);
          for (const file of files) {
            const id = newId();
            patch(chatId, (d) => ({ ...d, attachments: [...d.attachments, { id, name: "", originalName: file.name, size: file.size, kind: kindOf(file.name), status: "importing" }] }));
            try {
              const bytes = new Uint8Array(await file.arrayBuffer());
              const stored = await attachmentsApi.importBytes(file.name, bytes);
              await hydrate(chatId, id, stored, file.name);
            } catch (e) {
              const error = e instanceof Error ? e.message : String(e);
              patch(chatId, (d) => ({ ...d, attachments: d.attachments.map((a) => (a.id === id ? { ...a, status: "error", error } : a)) }));
            }
          }
        },
        addAttachmentPaths: async (chatId, paths) => {
          draft(chatId);
          for (const p of paths) {
            const originalName = p.split(/[\\/]/).pop() ?? p;
            const id = newId();
            patch(chatId, (d) => ({ ...d, attachments: [...d.attachments, { id, name: "", originalName, size: 0, kind: kindOf(originalName), status: "importing" }] }));
            try {
              const stored = await attachmentsApi.importFile(p);
              await hydrate(chatId, id, stored, originalName);
            } catch (e) {
              const error = e instanceof Error ? e.message : String(e);
              patch(chatId, (d) => ({ ...d, attachments: d.attachments.map((a) => (a.id === id ? { ...a, status: "error", error } : a)) }));
            }
          }
        },
        removeAttachment: (chatId, id) => patch(chatId, (d) => ({ ...d, attachments: d.attachments.filter((a) => a.id !== id) })),
        clearDraft: (chatId) => set((s) => { const { [chatId]: _gone, ...rest } = s.drafts; return { drafts: rest }; }),
      };
    },
    { name: "dnt-composer-drafts", version: 1, partialize: (s) => ({ drafts: stripForPersist(s.drafts) }) as unknown as ComposerState },
  ),
);
```

- [ ] **Step 5:** `npm test` → PASS. Commit: `feat(composer): per-chat draft store + attachment import pipeline`

---

### Task 5: TS — Lexical editor core (token node, ChatInput)

**Files:**
- Modify: `package.json` (deps)
- Create: `src/components/chat/composer/ContextTokenNode.tsx`
- Create: `src/components/chat/composer/ChatInput.tsx`
- Test: `src/components/chat/composer/ContextTokenNode.test.ts`

**Interfaces:**
- Produces: `ContextTokenNode` (type `"context-token"`, inline, serializes `{kind,id,label}`), `$createContextTokenNode({kind,id,label})`, `$isContextTokenNode(n)`, `tokenTextContent(label) = "@" + label`; node getters `getKind()/getId()/getLabel()`. `ChatInput` props:

```ts
export interface ChatInputProps {
  placeholder: string;
  initialEditorJson?: string | null;
  onChange: (editorJson: string, text: string) => void;
  onSubmit: () => void;
  onFilesPaste: (files: File[]) => void;
  onLongTextPaste: (text: string) => boolean; // true → handled (convert to attachment)
  onReady: (editor: LexicalEditor) => void;
  onMenuToggle: (open: boolean) => void;
  children?: ReactNode; // plugins (MentionPlugin) mount inside
}
```

- [ ] **Step 1: Install** `npm install lexical@^0.51.0 @lexical/react@^0.51.0`

- [ ] **Step 2: Failing headless test** — `ContextTokenNode.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { $createParagraphNode, $createRangeSelection, $createTextNode, $getRoot, $setSelection, createHeadlessEditor, type LexicalEditor } from "lexical";
import { $createContextTokenNode, $isContextTokenNode, insertNoteTokenAtCaret, ContextTokenNode } from "./ContextTokenNode";

function setup(text: string, caret: number): LexicalEditor {
  const editor = createHeadlessEditor({ namespace: "test", nodes: [ContextTokenNode], onError: () => {} });
  editor.update(() => {
    const p = $createParagraphNode();
    p.append($createTextNode(text));
    $getRoot().append(p);
    const sel = $createRangeSelection();
    sel.anchor.set(p.getFirstChild()!.getKey(), caret, "text");
    sel.focus.set(p.getFirstChild()!.getKey(), caret, "text");
    $setSelection(sel);
  }, { discrete: true });
  return editor;
}

describe("ContextTokenNode", () => {
  it("serializes and re-imports", () => {
    const editor = setup("", 0);
    editor.update(() => { $getRoot().getFirstChild()!.append($createContextTokenNode({ kind: "note", id: "n1", label: "Roadmap" })); }, { discrete: true });
    const json = JSON.stringify(editor.getEditorState().toJSON());
    const editor2 = createHeadlessEditor({ namespace: "t", nodes: [ContextTokenNode], onError: () => {} });
    editor2.setEditorState(editor2.parseEditorState(JSON.parse(json)));
    let seen = 0;
    editor2.getEditorState().read(() => {}); // no-op read
    editor2.update(() => {
      $getRoot().getAllTextNodes; // placeholder no-op
    }, { discrete: true });
    // assertion via text content below
    expect(editor2.getEditorState().read(() => require("lexical").$getRoot().getTextContent())).toBe("@Roadmap");
    seen = 1;
    expect(seen).toBe(1);
  });

  it("insertNoteTokenAtCaret replaces the @query with a token + space", () => {
    const editor = setup("hi @ro", "hi @ro".length);
    insertNoteTokenAtCaret(editor, { id: "n1", title: "Roadmap Q4" });
    const text = editor.getEditorState().read(() => $getRoot().getTextContent());
    expect(text.replace(/\u00a0/g, " ")).toBe("hi @Roadmap Q4 ");
    let found = false;
    editor.getEditorState().read(() => {
      $getRoot().getAllTextNodes; // walk children instead:
    });
    editor.update(() => {
      for (const node of $getRoot().getFirstDescendant()?.getParentOrThrow().getChildren() ?? []) {
        if ($isContextTokenNode(node)) found = true;
      }
    }, { discrete: true });
    expect(found).toBe(true);
  });
});
```

(When writing for real: drop the placeholder no-op lines, import `$getRoot` from `lexical` at top, and walk `$getRoot().getChildren()[0].getChildren()`.)

- [ ] **Step 3:** `npm test -- ContextTokenNode` → FAIL.

- [ ] **Step 4: Implement** `ContextTokenNode.tsx`:

```tsx
import { $applyNodeReplacement, $createRangeSelection, $createTextNode, $getRoot, $setSelection, DecoratorNode, type EditorConfig, type LexicalEditor, type LexicalNode, type RangeSelection, type SerializedLexicalNode, type Spread } from "lexical";
import { FileText, Sparkles } from "lucide-react";

export type TokenKind = "note" | "skill";
export interface TokenPayload { kind: TokenKind; id: string; label: string }
export type SerializedContextToken = Spread<TokenPayload, SerializedLexicalNode>;

export class ContextTokenNode extends DecoratorNode<JSX.Element> {
  private readonly kind: TokenKind;
  private readonly id: string;
  private readonly label: string;
  constructor(payload: TokenPayload, key?: string) {
    super(key);
    this.kind = payload.kind; this.id = payload.id; this.label = payload.label;
  }
  static getType(): string { return "context-token"; }
  static clone(node: ContextTokenNode): ContextTokenNode { return new ContextTokenNode({ kind: node.kind, id: node.id, label: node.label }, node.__key); }
  static importJSON(json: SerializedContextToken & { type?: string; version?: number }): ContextTokenNode {
    return $createContextTokenNode({ kind: json.kind, id: json.id, label: json.label });
  }
  exportJSON(): SerializedContextToken & { type: string; version: number } {
    return { type: ContextTokenNode.getType(), version: 1, kind: this.kind, id: this.id, label: this.label };
  }
  createDOM(_config: EditorConfig): HTMLElement { return document.createElement("span"); }
  updateDOM(): false { return false; }
  isInline(): boolean { return true; }
  getTextContent(): string { return `@${this.label}`; }
  getKind(): TokenKind { return this.kind; }
  getId(): string { return this.id; }
  getLabel(): string { return this.label; }
  decorate(): JSX.Element {
    const Icon = this.kind === "note" ? FileText : Sparkles;
    return (
      <span contentEditable={false} data-token-kind={this.kind} className="mx-0.5 inline-flex h-[22px] max-w-[220px] items-center gap-1 rounded-[7px] border border-hairline bg-subtle pl-1.5 pr-2 align-middle text-footnote text-fg">
        <Icon size={11} aria-hidden="true" className="shrink-0 text-fg-secondary" />
        <span className="truncate">{this.label}</span>
      </span>
    );
  }
}

export function $createContextTokenNode(payload: TokenPayload): ContextTokenNode {
  return $applyNodeReplacement(new ContextTokenNode(payload));
}
export function $isContextTokenNode(node: LexicalNode | undefined | null): node is ContextTokenNode {
  return node instanceof ContextTokenNode;
}

/** Replace the active "@query" before the caret with a note token (+ trailing space). */
export function insertNoteTokenAtCaret(editor: LexicalEditor, note: { id: string; title: string }): void {
  editor.update(() => {
    const sel = $getSelection() as RangeSelection | null;
    if (!sel || !sel.isCollapsed()) return;
    const node = sel.anchor.getNode();
    const text = node.getTextContent();
    const offset = sel.anchor.offset;
    const before = text.slice(0, offset);
    const m = /(?:^|[^A-Za-z0-9_])@([^\s@]*)$/.exec(before);
    const start = m ? offset - m[1].length - 1 : offset;
    const after = text.slice(offset);
    const token = $createContextTokenNode({ kind: "note", id: note.id, label: note.title });
    if ((node as import("lexical").TextNode).is?.()) {
      const writable = (node as import("lexical").TextNode).spliceText(start, offset - start, "", true);
      writable.insertAfter(token);
    } else {
      node.append?.(token);
    }
    const space = $createTextNode(" ");
    token.insertAfter(space);
    const rest = $createTextNode(after);
    space.insertAfter(rest);
    const newSel = $createRangeSelection();
    newSel.anchor.set(space.getKey(), 1, "text");
    newSel.focus.set(space.getKey(), 1, "text");
    $setSelection(newSel);
  }, { discrete: true });
}
```

(Import `$getSelection`, `TextNode` normally; adjust `is?.()` to `instanceof TextNode` when writing for real. If the caret node is not a TextNode, just append token+space to it and select the end.)

`ChatInput.tsx`:

```tsx
import { LexicalComposer } from "@lexical/react/LexicalComposer";
import { ContentEditable } from "@lexical/react/LexicalContentEditable";
import { HistoryPlugin } from "@lexical/react/LexicalHistoryPlugin";
import { LexicalErrorBoundary } from "@lexical/react/LexicalErrorBoundary";
import { OnChangePlugin } from "@lexical/react/LexicalOnChangePlugin";
import { PlainTextPlugin } from "@lexical/react/LexicalPlainTextPlugin";
import { $createLineBreakNode, $getRoot, KEY_ENTER_COMMAND, PASTE_COMMAND, type EditorState, type LexicalEditor } from "lexical";
import { useEffect, type ReactNode } from "react";
import { ContextTokenNode } from "./ContextTokenNode";

const PASTE_TO_ATTACHMENT_CHARS = 2000;

export interface ChatInputProps { /* as listed in Interfaces */ }

function BehaviorPlugin({ onSubmit, onFilesPaste, onLongTextPaste, menuOpenRef }: {
  onSubmit: () => void;
  onFilesPaste: (files: File[]) => void;
  onLongTextPaste: (text: string) => boolean;
  menuOpenRef: { current: boolean };
}) {
  const [editor] = (await import0()) as never; // placeholder — real impl below
  return null;
}
```

Real `BehaviorPlugin` (write this, not the placeholder):

```tsx
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_HIGH } from "lexical";

function BehaviorPlugin({ onSubmit, onFilesPaste, onLongTextPaste, menuOpenRef }: Props) {
  const [editor] = useLexicalComposerContext();
  useEffect(() => {
    return editor.registerCommand(
      KEY_ENTER_COMMAND,
      (event: KeyboardEvent) => {
        if (event.isComposing || event.keyCode === 229) return false;
        if (menuOpenRef.current) return false; // MentionPlugin consumes it first
        if (event.shiftKey) {
          editor.update(() => {
            const sel = $getSelection();
            if ($isRangeSelection(sel)) sel.insertNodes([$createLineBreakNode()]);
          });
          return true;
        }
        event.preventDefault();
        onSubmit();
        return true;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onSubmit, menuOpenRef]);
  useEffect(() => {
    return editor.registerCommand(
      PASTE_COMMAND,
      (event: ClipboardEvent) => {
        const files = Array.from(event.clipboardData?.files ?? []);
        if (files.length > 0) {
          event.preventDefault();
          onFilesPaste(files);
          return true;
        }
        const text = event.clipboardData?.getData("text/plain") ?? "";
        if (text.trim().length > PASTE_TO_ATTACHMENT_CHARS && onLongTextPaste(text)) {
          event.preventDefault();
          return true;
        }
        return false;
      },
      COMMAND_PRIORITY_HIGH,
    );
  }, [editor, onFilesPaste, onLongTextPaste]);
  return null;
}
```

`ChatInput` component:

```tsx
export function ChatInput(props: ChatInputProps) {
  const menuOpenRef = useRef(false);
  const initialConfig = useMemo(
    () => ({
      namespace: "ChatInput",
      nodes: [ContextTokenNode],
      onError: (e: Error) => console.error("[ChatInput]", e),
      editorState: props.initialEditorJson
        ? (editor: LexicalEditor) => {
            const parsed = editor.parseEditorState(props.initialEditorJson!);
            editor.setEditorState(parsed);
          }
        : undefined,
    }),
    [], // eslint-disable-line react-hooks/exhaustive-deps -- initial editor state must be read once
  );
  return (
    <LexicalComposer initialConfig={initialConfig}>
      <div className="relative">
        <PlainTextPlugin
          contentEditable={<ContentEditable className="block max-h-[200px] min-h-[52px] w-full overflow-y-auto whitespace-pre-wrap break-words bg-transparent px-2 py-1.5 text-body text-fg outline-none" aria-label="Tin nhắn cho trợ lý" />}
          placeholder={<div className="pointer-events-none absolute left-2 top-1.5 select-none px-2 py-1.5 text-body text-fg-tertiary">{props.placeholder}</div>}
          ErrorBoundary={LexicalErrorBoundary}
        />
        <HistoryPlugin />
        <BehaviorPlugin onSubmit={props.onSubmit} onFilesPaste={props.onFilesPaste} onLongTextPaste={props.onLongTextPaste} menuOpenRef={menuOpenRef} />
        <OnChangePlugin
          ignoreSelectionChange
          onChange={(editorState: EditorState, editor: LexicalEditor) => {
            const text = editorState.read(() => $getRoot().getTextContent());
            props.onChange(JSON.stringify(editorState.toJSON()), text);
            props.onReady(editor);
          }}
        />
        {props.children /* MentionPlugin mounts here and toggles menuOpenRef via onMenuToggle */}
      </div>
    </LexicalComposer>
  );
}
```

`onMenuToggle` is threaded by the shell into `MentionPlugin` (Task 6) which also sets `menuOpenRef` — expose it via a `MenuContext` created here: simplest is the shell passing `menuOpenRef` down as a render-prop child; the plan wires it in Task 6 where `MentionPlugin` is built. For Task 5, `ChatInput` accepts `children` and a `menuRef` prop (`menuOpenRef` supplied by the shell).

- [ ] **Step 5:** `npm test` → PASS; `npm run build` → PASS (tsc accepts Lexical types). Commit: `feat(composer): Lexical ChatInput with inline context tokens`

---

### Task 6: TS — MentionPlugin (popover) + composerStore draft wiring

**Files:**
- Create: `src/components/chat/composer/MentionPlugin.tsx`
- Test: `src/components/chat/composer/MentionPlugin.test.tsx`

**Interfaces:**
- Consumes: `activeTriggerQuery` (Task 3), `insertNoteTokenAtCaret`/`$isContextTokenNode` (Task 5), `fuzzyRank` (`src/lib/fuzzy.ts`), `useNotesStore`.
- Produces: `MentionPlugin` with props `{ editor: LexicalEditor; open: boolean; onOpenChange(open: boolean): void; excludedIds: string[] }` — pure child of `ChatInput`; plus exported `rankNoteCandidates(notes, query, excludedIds)` helper (tested without DOM).

- [ ] **Step 1: Failing tests** — pure part first:

```ts
import { describe, expect, it } from "vitest";
import { rankNoteCandidates } from "./MentionPlugin";

const notes = [
  { id: "1", title: "Roadmap Q4", snippet: "kế hoạch", pinned: false, updated: "" },
  { id: "2", title: "Họp tuần", snippet: "roadmap thời gian", pinned: false, updated: "" },
  { id: "3", title: "Sổ tay", snippet: "", pinned: false, updated: "" },
] as never;

it("ranks by title+snippet and caps at 8", () => {
  const out = rankNoteCandidates(notes, "road", []);
  expect(out.map((n) => n.id)).toEqual(["1", "2"]);
  expect(rankNoteCandidates(Array.from({ length: 12 }, (_, i) => ({ ...notes[0], id: `${i}` })), "", []).length).toBeLessThanOrEqual(8);
});
it("excludes already-tokenized notes", () => {
  expect(rankNoteCandidates(notes, "road", ["1"]).map((n) => n.id)).toEqual(["2"]);
});
```

Component part (jsdom): render `MentionPlugin` with `open` forced via a fake editor stub — keep to rendering the popover when `open` and candidates exist, calling `onSelect` on click:

```tsx
// inside describe("MentionPlugin popover")
render(<MentionPlugin editor={fakeEditor as never} open onOpenChange={vi.fn()} excludedIds={[]} />);
// fakeEditor = { registerUpdateListener: () => () => {}, read: (fn) => fn(), ... }
expect(screen.getByRole("listbox", { name: "Chọn ghi chú" })).toBeTruthy();
await userEvent.click(screen.getByRole("option", { name: /Roadmap Q4/ })); // fireEvent.click — no userEvent pkg
```

Use `fireEvent.click` (Testing Library only). Assert `insertNoteTokenAtCaret` called by spying via `vi.mock("./ContextTokenNode")`.

- [ ] **Step 2:** run → FAIL.

- [ ] **Step 3: Implement.** `MentionPlugin.tsx`:

```tsx
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLexicalComposerContext } from "@lexical/react/LexicalComposerContext";
import { COMMAND_PRIORITY_CRITICAL, KEY_ARROW_DOWN_COMMAND, KEY_ARROW_UP_COMMAND, KEY_ESCAPE_COMMAND, KEY_TAB_COMMAND, $getSelection, $isRangeSelection, $nodesOfType, type LexicalEditor } from "lexical";
import { FileText } from "lucide-react";
import { activeTriggerQuery } from "../../../lib/chat/triggers";
import { fuzzyRank } from "../../../lib/fuzzy";
import { useNotesStore } from "../../../lib/store/notesStore";
import type { NoteMeta } from "../../../lib/api/notes";
import { cn } from "../../../lib/utils";
import { insertNoteTokenAtCaret, $isContextTokenNode } from "./ContextTokenNode";

export function rankNoteCandidates(notes: NoteMeta[], query: string, excludedIds: string[]): NoteMeta[] {
  return fuzzyRank(notes, query, (n) => `${n.title} ${n.snippet}`)
    .map((r) => r.item)
    .filter((n) => !excludedIds.includes(n.id))
    .slice(0, 8);
}

export function MentionPlugin({ onOpenChange }: { onOpenChange: (open: boolean) => void }) {
  const [editor] = useLexicalComposerContext();
  const notes = useNotesStore((s) => s.notes);
  const [query, setQuery] = useState<string | null>(null);
  const [cursor, setCursor] = useState(0);
  const dismissedRef = useRef(false);

  const excludedIds = useMemo(
    () => editor.getEditorState().read(() => $nodesOfType(ContextTokenNodeClass).map((n) => n.getId())),
    [editor, query],
  );
  const candidates = useMemo(
    () => (query === null || dismissedRef.current ? [] : rankNoteCandidates(notes, query, excludedIds)),
    [query, notes, excludedIds],
  );

  useEffect(() => { onOpenChange(candidates.length > 0); }, [candidates.length, onOpenChange]);

  useEffect(
    () =>
      editor.registerUpdateListener(({ editorState }) => {
        editorState.read(() => {
          dismissedRef.current = false;
          const sel = $getSelection();
          if (!$isRangeSelection(sel) || !sel.isCollapsed()) return setQuery(null);
          const node = sel.anchor.getNode();
          if (!(node instanceof import("lexical").TextNode)) return setQuery(null);
          setQuery(activeTriggerQuery(node.getTextContent().slice(0, sel.anchor.offset)));
        });
      }),
    [editor],
  );

  const pick = useCallback(
    (note: NoteMeta) => {
      insertNoteTokenAtCaret(editor, note);
      setQuery(null);
    },
    [editor],
  );

  useEffect(() => {
    const handlers = [
      editor.registerCommand(KEY_ARROW_DOWN_COMMAND, () => candidates.length ? (setCursor((c) => (c + 1) % candidates.length), true) : false, COMMAND_PRIORITY_CRITICAL),
      editor.registerCommand(KEY_ARROW_UP_COMMAND, () => candidates.length ? (setCursor((c) => (c - 1 + candidates.length) % candidates.length), true) : false, COMMAND_PRIORITY_CRITICAL),
      editor.registerCommand(KEY_TAB_COMMAND, (e) => { if (candidates.length) { e.preventDefault(); pick(candidates[cursor]); return true; } return false; }, COMMAND_PRIORITY_CRITICAL),
      editor.registerCommand(KEY_ENTER_COMMAND? as never, () => (candidates.length ? (pick(candidates[cursor]), true) : false), COMMAND_PRIORITY_CRITICAL),
      editor.registerCommand(KEY_ESCAPE_COMMAND, () => { if (candidates.length) { dismissedRef.current = true; setQuery(null); return true; } return false; },
        COMMAND_PRIORITY_CRITICAL),
    ];
    return () => handlers.forEach((d) => d());
  }, [editor, candidates, cursor, pick]);

  if (candidates.length === 0) return null;
  return (
    <div role="listbox" aria-label="Chọn ghi chú" id="mention-list" className="absolute bottom-full left-0 right-0 z-10 mb-2 max-h-[300px] overflow-y-auto rounded-[16px] border border-composer-border bg-popover p-1.5 shadow-popover">
      <div className="px-2.5 pb-1 pt-1 text-caption font-medium text-fg-secondary">Nhắc tới ghi chú</div>
      {candidates.map((n, i) => (
        <button key={n.id} type="button" role="option" aria-selected={i === cursor}
          onMouseDown={(e) => e.preventDefault()} onMouseEnter={() => setCursor(i)} onClick={() => pick(n)}
          className={cn("flex h-11 w-full items-center gap-2.5 rounded-[10px] px-2.5 text-left", i === cursor && "bg-hover")}>
          <FileText size={14} aria-hidden="true" className="shrink-0 text-fg-secondary" />
          <span className="min-w-0 flex-1">
            <span className="block truncate text-callout font-medium text-fg">{n.title}</span>
            <span className="block truncate text-caption text-fg-secondary">{n.snippet || "Chưa có nội dung"}</span>
          </span>
        </button>
      ))}
    </div>
  );
}
```

(Clean up when writing for real: import `ContextTokenNode` directly instead of `ContextTokenNodeClass`, import `TextNode` at top, and use `KEY_ENTER_COMMAND` from lexical.)

- [ ] **Step 4:** `npm test` → PASS. Commit: `feat(composer): mention popover plugin with caret-anchored @ trigger`

---

### Task 7: TS — composer shell (tray, toolbar, safe send) + ChatPanel wiring

**Files:**
- Create: `src/components/chat/composer/AttachmentTray.tsx`
- Create: `src/components/chat/composer/Composer.tsx` (new shell)
- Delete: `src/components/chat/Composer.tsx`
- Modify: `src/components/chat/ChatPanel.tsx` (import path, `key={chatId}`, drop overlay)
- Test: `src/components/chat/composer/Composer.test.tsx`

**Interfaces:**
- Consumes: Tasks 3–6 (`useComposerStore`, `ChatInput`, `MentionPlugin`, `useChatStore.send` new signature from Task 8 — **order note:** implement Task 8's `send` signature first or land this task with the payload call and complete the signature change in Task 8 in the same session; the final `npm test` gate runs after Task 8).
- Produces: `Composer` with `forwardRef<ComposerHandle>` — `focus()`, `setText(text)`; props `{ placeholder: string; compact?: boolean }` (unchanged contract for ChatPanel).

- [ ] **Step 1: Failing component test** — `Composer.test.tsx`:

```tsx
import { beforeEach, describe, expect, it, vi } from "vitest";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";

const invoke = vi.fn();
vi.mock("@tauri-apps/api/core", () => ({ invoke: (...a: unknown[]) => invoke(...a) }));
const openDialog = vi.fn();
vi.mock("@tauri-apps/plugin-dialog", () => ({ open: (...a: unknown[]) => openDialog(...a) }));

import { Composer } from "./Composer";
import { useChatStore } from "../../../lib/store/chatStore";
import { useComposerStore } from "../../../lib/store/composerStore";
import { useNotesStore } from "../../../lib/store/notesStore";

beforeEach(() => {
  invoke.mockReset();
  useNotesStore.setState({ notes: [], selectedId: null, tags: [] });
  useComposerStore.setState({ drafts: {} });
});

it("send disabled with empty draft; enabled with a ready attachment", async () => {
  invoke.mockResolvedValue({ name: "u.png", size: 1, path: "C:/u.png" });
  render(<Composer placeholder="Hỏi…" />);
  const send = screen.getByRole("button", { name: "Gửi (Enter)" });
  expect(send).toBeDisabled();
  openDialog.mockResolvedValue(["C:/pic.png"]);
  fireEvent.click(screen.getByRole("button", { name: "Đính kèm file" }));
  await waitFor(() => expect(useComposerStore.getState().drafts).toBeTruthy());
  // after ready:
  await waitFor(() => expect(screen.getByRole("button", { name: "Gửi (Enter)" })).toBeEnabled());
});

it("sends payload with attachment and clears draft on ok", async () => {
  invoke.mockResolvedValueOnce({ name: "uuid-a.png", size: 3, path: "C:/a.png" })
       .mockResolvedValueOnce("data:image/png;base64,AA");
  const spy = vi.fn().mockResolvedValue({ ok: true });
  useChatStore.setState({ status: "idle", send: spy as never });
  render(<Composer placeholder="Hỏi…" />);
  await useComposerStore.getState().addAttachmentFiles(useChatStore.getState().chatId, [
    new File([new Uint8Array(3)], "a.png", { type: "image/png" }),
  ]);
  await waitFor(() => expect(screen.getByRole("button", { name: "Gửi (Enter)" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Gửi (Enter)" }));
  await waitFor(() => expect(spy).toHaveBeenCalled());
  const payload = spy.mock.calls[0][0];
  expect(payload.attachments[0].name).toBe("uuid-a.png");
  expect(useComposerStore.getState().drafts[useChatStore.getState().chatId]).toBeUndefined();
});

it("keeps draft when send rejected", async () => {
  invoke.mockResolvedValue({ name: "u.png", size: 1, path: "C:/u.png" });
  const spy = vi.fn().mockResolvedValue({ ok: false, error: "Chưa cấu hình provider AI" });
  useChatStore.setState({ status: "idle", send: spy as never, error: "Chưa cấu hình provider AI" });
  render(<Composer placeholder="Hỏi…" />);
  await useComposerStore.getState().addAttachmentPaths(useChatStore.getState().chatId, ["C:/u.png"]);
  await waitFor(() => expect(screen.getByRole("button", { name: "Gửi (Enter)" })).toBeEnabled());
  fireEvent.click(screen.getByRole("button", { name: "Gửi (Enter)" }));
  await waitFor(() => expect(spy).toHaveBeenCalled());
  expect(useComposerStore.getState().drafts[useChatStore.getState().chatId]).toBeDefined();
});
```

- [ ] **Step 2:** run → FAIL (module missing).

- [ ] **Step 3: Implement.** `AttachmentTray.tsx`:

```tsx
import { FileText, ImageIcon, Loader2, X } from "lucide-react";
import type { DraftAttachment } from "../../../lib/store/composerStore";

export function fmtSize(bytes: number): string {
  if (bytes >= 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  if (bytes >= 1024) return `${Math.round(bytes / 1024)} KB`;
  return `${bytes} B`;
}

export function AttachmentTray({ items, onRemove }: { items: DraftAttachment[]; onRemove: (id: string) => void }) {
  if (items.length === 0) return null;
  return (
    <div className="mb-1.5 flex flex-wrap gap-1.5 px-1">
      {items.map((a) => (
        <div key={a.id} role="listitem" aria-label={a.originalName}
          className="relative flex w-[190px] items-center gap-2 rounded-[11px] border border-composer-border bg-control p-1.5 pr-6">
          {a.status === "importing" ? (
            <span className="flex size-8 items-center justify-center"><Loader2 size={14} className="animate-spin text-fg-secondary" /></span>
          ) : a.kind === "image" && a.previewUrl ? (
            <img src={a.previewUrl} alt="" className="size-8 rounded-md object-cover" />
          ) : (
            <span className="flex size-8 items-center justify-center rounded-md bg-subtle text-fg-secondary">
              {a.kind === "image" ? <ImageIcon size={14} /> : <FileText size={14} />}
            </span>
          )}
          <span className="min-w-0 flex-1">
            <span className="block truncate text-footnote text-fg">{a.originalName}</span>
            <span className="block truncate text-caption text-fg-tertiary">
              {a.status === "error" ? a.error : a.status === "importing" ? "Đang thêm…" : `${a.kind === "image" ? "Ảnh" : "Tài liệu"} · ${fmtSize(a.size)}`}
            </span>
          </span>
          <button type="button" aria-label={`Bỏ ${a.originalName}`} onClick={() => onRemove(a.id)}
            className="absolute right-1 top-1 flex size-5 items-center justify-center rounded-full text-fg-tertiary hover:bg-hover hover:text-fg">
            <X size={11} aria-hidden="true" />
          </button>
        </div>
      ))}
    </div>
  );
}
```

`Composer.tsx` (shell):

```tsx
import { forwardRef, useCallback, useImperativeHandle, useRef, useState } from "react";
import { open as openFileDialog } from "@tauri-apps/plugin-dialog";
import { ArrowUp, AtSign, Paperclip } from "lucide-react";
import type { LexicalEditor } from "lexical";
import { $createParagraphNode, $getRoot, $nodesOfType } from "lexical";
import { useChatStore } from "../../../lib/store/chatStore";
import { useComposerStore } from "../../../lib/store/composerStore";
import { useNotesStore } from "../../../lib/store/notesStore";
import { api as notesApi } from "../../../lib/api/notes";
import type { MentionInput } from "../../../lib/chat/payload";
import { cn } from "../../../lib/utils";
import { ChatInput } from "./ChatInput";
import { MentionPlugin } from "./MentionPlugin";
import { AttachmentTray } from "./AttachmentTray";
import { ContextTokenNode } from "./ContextTokenNode";

export interface ComposerHandle { focus: () => void; setText: (text: string) => void }
interface ComposerProps { placeholder: string; compact?: boolean }

const DIALOG_FILTERS = [{ name: "Đính kèm", extensions: ["png","jpg","jpeg","gif","webp","bmp","pdf","docx","rtf","odt","txt","md","csv","json","rs","py","js","ts","tsx","jsx","go","java","c","cpp","html","css","toml","yaml","yml","xml","sh"] }];

export const Composer = forwardRef<ComposerHandle, ComposerProps>(function Composer({ placeholder, compact }, ref) {
  const chatId = useChatStore((s) => s.chatId);
  const status = useChatStore((s) => s.status);
  const send = useChatStore((s) => s.send);
  const stop = useChatStore((s) => s.stop);
  const notes = useNotesStore((s) => s.notes);
  const selectedId = useNotesStore((s) => s.selectedId);
  const draft = useComposerStore((s) => s.drafts[chatId]);
  const setEditorState = useComposerStore((s) => s.setEditorState);
  const addFiles = useComposerStore((s) => s.addAttachmentFiles);
  const addPaths = useComposerStore((s) => s.addAttachmentPaths);
  const removeAttachment = useComposerStore((s) => s.removeAttachment);
  const clearDraft = useComposerStore((s) => s.clearDraft);

  const editorRef = useRef<LexicalEditor | null>(null);
  const menuOpenRef = useRef(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const [text, setTextState] = useState("");

  useImperativeHandle(ref, () => ({
    focus: () => editorRef.current?.focus(),
    setText: (t: string) =>
      editorRef.current?.update(() => {
        const root = $getRoot();
        root.clear();
        const p = $createParagraphNode();
        p.append(...([] as never[])); // append a text node with t:
        root.append(p);
      }, { discrete: true }),
  }));
```

(When writing for real, `setText` appends `$createTextNode(t)` and focuses end; the plan's pseudo-line is replaced by the real node calls.)

Continue shell:

```tsx
  const ready = draft?.attachments.filter((a) => a.status === "ready") ?? [];
  const errorCount = draft?.attachments.filter((a) => a.status === "error").length ?? 0;
  const canSend = (text.trim().length > 0 || ready.length > 0) && status !== "streaming";

  const doSend = useCallback(async () => {
    const editor = editorRef.current;
    if (!editor) return;
    if (status === "streaming") return;
    const tokens = editor.getEditorState().read(() =>
      $nodesOfType(ContextTokenNode).map((n) => ({ kind: n.getKind(), id: n.getId(), label: n.getLabel() })),
    );
    const editorText = editor.getEditorState().read(() => $getRoot().getTextContent());
    const attachments = ready.map(({ id, name, originalName, size, kind, text, previewUrl }) => ({ id, name, originalName, size, kind, text, previewUrl }));
    if (!editorText.trim() && attachments.length === 0) return;
    const seen = new Set<string>();
    const mentions: MentionInput[] = [];
    for (const t of tokens.filter((t) => t.kind === "note")) {
      if (seen.has(t.id)) continue;
      seen.add(t.id);
      try {
        const note = await notesApi.notes.read(t.id);
        mentions.push({ id: t.id, title: t.label, body: note.body });
      } catch {
        mentions.push({ id: t.id, title: t.label, body: "", failed: true });
      }
    }
    const result = await send({ text: editorText, mentions, attachments });
    if (result.ok) {
      clearDraft(chatId);
      setTextState("");
      editor.update(() => { $getRoot().clear(); $getRoot().append($createParagraphNode()); }, { discrete: true });
    }
  }, [chatId, ready, send, status, clearDraft]);

  const attach = async () => {
    const picked = await openFileDialog({ multiple: true, filters: DIALOG_FILTERS });
    if (!picked) return;
    await addPaths(chatId, Array.isArray(picked) ? picked : [picked]);
  };

  const insertAt = () => {
    editorRef.current?.focus();
    editorRef.current?.update(() => {
      const sel = $getSelection();
      if ($isRangeSelection(sel) && sel.isCollapsed()) { if (!/\s$/.test(/*node text before*/ "")) {} sel.insertText(" @"); }
    });
  };
```

(When writing for real, `insertAt` simply inserts `"@"` at the caret via `sel.insertText("@")` after focusing, prefixed with a space when the preceding character is non-space — read the anchor node text to decide.)

Render:

```tsx
  const current = notes.find((n) => n.id === selectedId);
  const contextSummary = [
    ready.length ? `${ready.length} file` : null,
    text.match? 0 : 0, // placeholder — real: count tokens from last change; simpler: omit token count, keep file count + menuOpen
  ].filter(Boolean).join(" · ");

  return (
    <div className="relative rounded-xl border border-composer-border bg-composer p-2.5 shadow-[0_3px_10px_rgba(0,0,0,0.06)]">
      <AttachmentTray items={draft?.attachments ?? []} onRemove={(id) => removeAttachment(chatId, id)} />
      <ChatInput
        placeholder={placeholder}
        initialEditorJson={draft?.editorJson ?? null}
        onChange={(json, t) => { setTextState(t); setEditorState(chatId, json, t); }}
        onSubmit={() => void doSend()}
        onFilesPaste={(files) => void addFiles(chatId, files)}
        onLongTextPaste={(t) => {
          void addFiles(chatId, [new File([new TextEncoder().encode(t)], "van-ban-da-dan.txt", { type: "text/plain" })]);
          return true;
        }}
        onReady={(e) => { editorRef.current = e; if (!draft?.editorJson) requestAnimationFrame(() => e.focus()); }}
        menuOpenRef={menuOpenRef}
      >
        <MentionPlugin onOpenChange={(open) => { menuOpenRef.current = open; setMenuOpen(open); }} />
      </ChatInput>
      <div className="mt-1 flex items-center gap-1">
        <button type="button" aria-label="Đính kèm file" title="Đính kèm file" onClick={() => void attach()}
          className="flex size-[34px] items-center justify-center rounded-full text-fg transition-colors hover:bg-composer-hover">
          <Paperclip size={17} strokeWidth={1.75} aria-hidden="true" />
        </button>
        <button type="button" aria-label="Nhắc tới ghi chú (@)" title="Nhắc tới ghi chú (@)" onClick={insertAt}
          className="flex size-[34px] items-center justify-center rounded-full text-fg transition-colors hover:bg-composer-hover">
          <AtSign size={17} strokeWidth={1.75} aria-hidden="true" />
        </button>
        {contextSummary && <span className="ml-1 text-caption text-fg-tertiary">{contextSummary}</span>}
        {errorCount > 0 && <span className="ml-1 text-caption text-danger">{errorCount} file lỗi</span>}
        <div className="flex-1" />
        {status === "streaming" ? (
          <button type="button" onClick={stop} aria-label="Dừng tạo câu trả lời" title="Dừng"
            className="flex size-[34px] items-center justify-center rounded-full bg-accent transition-colors hover:bg-accent-hover">
            <span aria-hidden="true" className="size-[11px] rounded-[2.5px] bg-accent-fg" />
          </button>
        ) : (
          <button type="button" onClick={() => void doSend()} disabled={!canSend}
            aria-label="Gửi (Enter)" title="Gửi (Enter) · Shift+Enter để xuống dòng"
            className={cn("flex size-[34px] items-center justify-center rounded-full transition-colors",
              canSend ? "bg-accent text-accent-fg hover:bg-accent-hover" : "bg-send-disabled text-send-disabled-fg")}>
            <ArrowUp size={17} strokeWidth={2.5} aria-hidden="true" />
          </button>
        )}
      </div>
    </div>
  );
});
```

Delete `src/components/chat/Composer.tsx`. In `ChatPanel.tsx`: import from `"./composer/Composer"`, add `key={chatId}` to both `<Composer>` usages, add the drop overlay (see Task 8 wire-up; can land here):

```tsx
const [dropping, setDropping] = useState(false);
const addFiles = useComposerStore((s) => s.addAttachmentFiles);
// on <section>:
onDragOver={(e) => { if (e.dataTransfer.types.includes("Files")) { e.preventDefault(); setDropping(true); } }}
onDragLeave={(e) => { if (!e.currentTarget.contains(e.relatedTarget as Node)) setDropping(false); }}
onDrop={(e) => { const files = Array.from(e.dataTransfer.files); if (files.length) { e.preventDefault(); setDropping(false); void addFiles(chatId, files); } }}
// add className "relative" to section; overlay:
{dropping && (
  <div className="absolute inset-0 z-20 flex items-center justify-center border-2 border-dashed border-accent bg-app/85 rounded-lg m-2">
    <p className="text-callout font-medium text-fg">Thả file để đính kèm</p>
  </div>
)}
```

- [ ] **Step 4:** `npm test` → new tests pass except send-signature-dependent ones may compile against old `send` — Task 8 completes it; run full gate after Task 8. Commit: `feat(composer): shell with attachment tray, safe send, drop overlay`

---

### Task 8: TS — chatStore refactor (safe send, runs, retry, persistence) + MessageList chips

**Files:**
- Modify: `src/lib/store/chatStore.ts`
- Modify: `src/lib/store/chatStore.test.ts` (adapt + new cases)
- Modify: `src/components/chat/MessageList.tsx` (attachment chips)
- Modify: `src/lib/api/chats.ts` (DTO fields)

**Interfaces:**
- Produces: `send(payload: { text: string; mentions: MentionInput[]; attachments: AttachmentInput[] }): Promise<{ ok: true } | { ok: false; error: string }>`; `UiMessage.attachments?: AttachmentInput[]`; `retryLast()` re-resolves from message metadata; persistence keeps `mentions`/`attachments`/`error`.

- [ ] **Step 1: Adapt tests first.** In `chatStore.test.ts`, replace every `send("text", mentions)` call with `await send({ text: "text", mentions, attachments: [] })`; the no-model rejection test asserts `res = await send({...})` → `res.ok === false` and `messages` still empty. New cases:

```ts
it("stop then quick resend: the old run cannot clobber the new one", async () => {
  // provider ok; first send never resolves (fetch hangs); stop(); second send resolves;
  // assert final status idle and only ONE assistant pair after the second exchange completes.
});
it("retry re-reads mention bodies and attachment files", async () => {
  // send with mention n1 + document attachment; after done, mock notes.read → new body,
  // extractText → "new"; retryLast(); assert runAgent received the new body/text in the request.
});
it("persist saves structured metadata; load restores chips", async () => {
  // after a completed send with mention + image attachment: chats.save called with
  // messages[0].mentions[0].id and attachments[0].name; simulate loadChat with that DTO →
  // messages[0].mentions restored.
});
it("assistant error persists as error field, not ⚠ in content", async () => {
  // error event → persisted DTO has error: "..." and content without "⚠".
});
```

(Fill with the same mock style already used in the file — provider via `useSettingsStore.setState`, `runAgent` via `vi.mock("../agent/engine")`, `api.chats` via `vi.mock("../api/chats")` — plus `vi.mock("../api/notes")` for retry and `vi.mock("../api/attachments")` for prepareImage/extractText.)

- [ ] **Step 2:** run → FAIL against old store.

- [ ] **Step 3: Implement chatStore** — key diffs from current file:

```ts
import { buildRequestUserMessage, MAX_DOC_CHARS, type AttachmentInput, type MentionInput } from "../chat/payload";
import { attachmentsApi } from "../api/attachments";
import { api as notesApi } from "../api/notes";
// types
export type { MentionInput, AttachmentInput } from "../chat/payload";
export interface UiMessage { /* existing */ attachments?: AttachmentInput[] }
export type SendResult = { ok: true } | { ok: false; error: string };
export interface SendPayload { text: string; mentions: MentionInput[]; attachments: AttachmentInput[] }
// module scope: replace `let controller` and `let lastMentions` with
const controllers = new Map<string, AbortController>();
let activeRunId: string | null = null;
```

`persistChat` mapping:

```ts
messages: messages.map((m) => ({
  role: m.role,
  content: m.content,
  ...(m.mentions ? { mentions: m.mentions } : {}),
  ...(m.attachments ? { attachments: m.attachments.map(({ text: _t, previewUrl: _p, ...rest }) => rest) } : {}),
  ...(m.error ? { error: m.error } : {}),
})),
```

`send` head:

```ts
send: async (payload) => {
  if (get().status === "streaming") return { ok: false, error: "Trợ lý đang trả lời — vui lòng đợi hoặc dừng." };
  const ready = payload.attachments;
  if (!payload.text.trim() && ready.length === 0) return { ok: false, error: "Nhập nội dung hoặc đính kèm file." };
  const provider = useSettingsStore.getState().activeProvider();
  if (!provider) { const error = "Chưa cấu hình provider AI — mở Cài đặt → Nhà cung cấp AI."; set({ error }); return { ok: false, error }; }
  if (!provider.model) { const error = `“${provider.name}” chưa có model nào — mở Cài đặt → Nhà cung cấp AI để thêm model.`; set({ error }); return { ok: false, error }; }

  const requestUser = buildRequestUserMessage(payload.text, payload.mentions, payload.attachments);
  const userMsg: UiMessage = {
    id: newId(), role: "user", content: payload.text,
    ...(payload.mentions.length ? { mentions: payload.mentions.map(({ id, title, failed }) => ({ id, title, ...(failed ? { failed } : {}) })) } : {}),
    ...(payload.attachments.length ? { attachments: payload.attachments } : {}),
  };
```

(`UiMention` gains optional `failed?: boolean` so the sent bubble can badge unreadable notes.)

History computed **before** inserting: `const history = get().messages.filter((m) => !m.error).map((m) => ({ role: m.role, content: m.content }));` then set/append, then:

```ts
const runId = newId();
activeRunId = runId;
const controller = new AbortController();
controllers.set(runId, controller);
try {
  await runAgent({ provider, messages: [...history, requestUser], systemPrompt, signal: controller.signal, onEvent: handleEvent });
} catch (e) { /* unchanged abort handling */ }
finally {
  controllers.delete(runId);
  if (activeRunId === runId) {
    activeRunId = null;
    set({ status: "idle" });
    /* unchanged title/persist block */
  }
}
return { ok: true };
```

`stop`:

```ts
stop: () => { if (activeRunId) controllers.get(activeRunId)?.abort(); },
```

`retryLast`:

```ts
retryLast: async () => {
  const { messages, status } = get();
  if (status === "streaming") return;
  const idx = messages.map((m) => m.role).lastIndexOf("user");
  if (idx < 0) return;
  const msg = messages[idx];
  const mentions: MentionInput[] = await Promise.all(
    (msg.mentions ?? []).map(async (m) => {
      try { const note = await notesApi.notes.read(m.id); return { id: m.id, title: m.title, body: note.body, ...(m.failed ? { failed: true } : {}) }; }
      catch { return { id: m.id, title: m.title, body: "", failed: true }; }
    }),
  );
  const attachments: AttachmentInput[] = await Promise.all(
    (msg.attachments ?? []).map(async (a) => {
      try {
        if (a.kind === "image") return { ...a, previewUrl: await attachmentsApi.prepareImage(a.name) };
        return { ...a, text: (await attachmentsApi.extractText(a.name)).slice(0, MAX_DOC_CHARS) };
      } catch { return { ...a }; }
    }),
  );
  set({ messages: messages.slice(0, idx) });
  const res = await get().send({ text: msg.content, mentions, attachments });
  if (!res.ok) set({ messages }); // validation failed — restore the exchange
},
```

`loadChat` mapping restores metadata:

```ts
messages: session.messages
  .filter((m) => m.role === "user" || m.role === "assistant")
  .map((m) => ({
    id: newId(), role: m.role as "user" | "assistant", content: m.content ?? "",
    ...(m.mentions?.length ? { mentions: m.mentions } : {}),
    ...(m.attachments?.length ? { attachments: m.attachments } : {}),
    ...(m.error ? { error: m.error } : {}),
  })),
```

`src/lib/api/chats.ts` DTO:

```ts
export interface ChatMentionDto { id: string; title: string; failed?: boolean }
export interface ChatAttachmentDto { id: string; name: string; originalName: string; size: number; kind: "image" | "document" }
export interface ChatMessageDto {
  role: string; content: string | null;
  mentions?: ChatMentionDto[]; attachments?: ChatAttachmentDto[]; error?: string;
  toolCalls?: unknown; toolCallId?: string; name?: string;
}
```

`MessageList.tsx` `UserMessage` — add attachment row (before the text bubble):

```tsx
{message.attachments && message.attachments.length > 0 && (
  <div className="flex max-w-[85%] flex-wrap justify-end gap-1.5">
    {message.attachments.map((a) =>
      a.kind === "image" && a.previewUrl ? (
        <img key={a.id} src={a.previewUrl} alt={a.originalName} className="max-h-40 rounded-lg border border-hairline" />
      ) : (
        <span key={a.id} className="inline-flex h-6 max-w-[220px] items-center gap-1 rounded-full border border-hairline px-2 text-footnote text-fg-secondary">
          <FileText size={11} aria-hidden="true" />
          <span className="truncate">{a.originalName}</span>
        </span>
      ),
    )}
  </div>
)}
```

Also badge failed mentions: in the mentions map, `{"⚠ "}`-free approach — `{m.failed ? `${m.title} (không đọc được)` : m.title}`.

- [ ] **Step 4:** Full gates: `npm test` (all suites incl. Composer from Task 7), `npm run build`, `cargo test --workspace` → PASS.

- [ ] **Step 5:** Commit: `feat(chat): safe send with message-bound context, per-run abort, structured persistence`

---

### Task 9: Docs + final verification

- [ ] Update `README.md`: composer section — inline `@` tokens, attachment tray (paperclip/paste/drop), image vision parts, structured chat metadata, draft persistence per chat; fix the stale "70 tests" verification number to the current count after the final run.
- [ ] Run all three gates once more; note the final test counts in the README verification section.
- [ ] Commit: `docs: composer refactor notes + test counts`

---

## Self-Review (done during planning)

- **Spec coverage:** tokens (T5/T6), tray+paste+drop+paperclip (T4/T7), safe send (T7/T8), run ownership (T8), retry from message (T8), structured persistence + reload chips (T1/T8), cleanup awareness (T1), import-only Rust (T2), relative-name resolution (T2), content parts (T3), draft persistence (T4), `/` future-proofing (T3 `activeTriggerQuery` generic). Gaps: none open.
- **Placeholders:** pseudo-lines flagged "when writing for real" are called out in-place and are mechanical (imports/real node calls), not design gaps.
- **Type consistency:** `SendPayload`/`SendResult` (T8) matches Composer's call (T7); `AttachmentInput` shared by store/message/wire; `StoredFile.path` matches Rust `StoredFile`.
