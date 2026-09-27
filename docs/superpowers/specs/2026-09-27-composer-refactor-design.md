# Chat Composer Refactor — Design

**Date:** 2026-09-27
**Status:** Approved (user approved the ZCode-adapted direction and authorized autonomous SDD execution)
**Reference:** `docs/research/2026-09-27-zcode-chat-composer.md`, `docs/superpowers/specs/2026-09-27-phases-5-7-media-skills-extras-design.md`

## Problem

The current composer (`src/components/chat/Composer.tsx`) is a plain textarea plus detached mention chips. It has structural problems that block the approved Phase 5–7 work:

1. **Draft loss** — `doSend()` clears draft/mentions before `chatStore.send()` validates provider/model, so a rejected send destroys the user's input.
2. **Detached mentions** — chips are separate state from the text; they can't be positioned in the sentence, survive `setText()`, or be serialized with the draft.
3. **No attachments** — no file picker, paste, drag/drop, tray, or vision content, although the Rust backend (import, image preparation, text extraction) already exists.
4. **Global retry context** — `lastMentions` module global can mismatch the retried message or session.
5. **Global abort controller** — `stop()` sets `status: "idle"` while the old run's `finally` may still fire, racing a new send.
6. **Lossy persistence** — mentions/attachments/tool state/errors are stripped when saving chats; reloaded history shows plain text only.

## Goal

Rebuild the composer on the ZCode interaction model, scoped to DNT Note's domain:

- A structured editor where **`@note` mentions are atomic inline tokens** in the sentence.
- **External files are attachments** in a tray inside the composer shell (image preview, PDF/file icon, size, remove), added via paperclip, paste, or drag/drop.
- **Safe send** — the draft clears only after the store accepts the message.
- **Message-bound context** — mentions and attachments live on the user message; retry rebuilds from the message, not globals.
- **Structured persistence** — chat JSON keeps mention/attachment/error metadata; reloaded history renders chips.
- **Run ownership** — each generation has a run id; stop/send cannot race.

## Non-goals

- Skills/`/` trigger UI (Phase 6). The trigger parser is generalized so `slashQuery` can be added later without redesign; no dead UI ships now.
- ZCode coding-specific categories (plugins, agents, whiteboards, sessions), permission modes, Computer Use, draft queueing while streaming, configurable shortcuts.
- Media library (`list_media`, `read_attachment` tools) — Phase 5 media management stays separate.
- Sending images in **history** turns: only the current turn carries image parts; prior turns degrade to text (consistent with today's mention handling).
- Changing the agent loop, tools, or provider protocol beyond the content-parts type.

## Architecture

### Editor: Lexical

Adopt `lexical` + `@lexical/react` (0.51.x) — the same foundation ZCode uses. Rationale: atomic decorator nodes, IME/caret/paste handling, and editor-state serialization are exactly the problems a hand-rolled contenteditable gets wrong. The app is a desktop Tauri app; the bundle cost is acceptable.

### New module layout

```
src/components/chat/composer/
  ChatInput.tsx        Lexical editor: text + token nodes, bounded auto-grow,
                       Enter/Shift+Enter/IME, paste interception, drop target
  ContextTokenNode.tsx DecoratorNode — {kind: "note"|"skill", id, label}
                       (kind "skill" reserved, not produced yet)
  MentionPlugin.tsx    Detects the active "@query" before the caret, renders the
                       popover listbox, keyboard navigation, token insertion
  AttachmentTray.tsx   Attachment items with preview/status/remove
  Composer.tsx         Shell: ChatInput + tray + toolbar (attach, @, context
                       count, send/stop); exposes ComposerHandle {focus, setText}
src/lib/store/composerStore.ts   Per-chat draft state + attachment pipeline
src/lib/chat/payload.ts          Pure builders: LLM user content + OpenAI parts
```

`src/components/chat/Composer.tsx` is replaced by `composer/Composer.tsx`. `ChatPanel` keeps using `ComposerHandle` unchanged.

### Data model

**Token (inline context)** — `ContextTokenNode` stores `{kind, id, label}` and serializes into the Lexical editor state (JSON). Exported as markdown-ish text `@label` when reading the plain text of a draft. Notes only for now.

**Composer draft** (`composerStore`, zustand + persist to localStorage, keyed by chat id):

```ts
interface DraftAttachment {
  id: string;            // client id
  name: string;          // stored file name (uuid-prefixed) in attachments dir
  originalName: string;
  size: number;
  kind: "image" | "document";
  status: "importing" | "ready" | "error";
  error?: string;        // import/prepare failure (Vietnamese, user-facing)
  text?: string;         // extracted document text (documents only, ≤20k chars)
  previewUrl?: string;   // data URL for images (transient, never persisted)
}
interface Draft { editorJson: string | null; text: string; attachments: DraftAttachment[] }
```

Persisted draft stores everything except `previewUrl` (re-prepared from `name` on restore). Switching chats saves/restores drafts; sending (accepted) clears the chat's draft.

**User message metadata** (`chatStore`):

```ts
interface UiAttachment { id: string; name: string; originalName: string; size: number; kind: "image" | "document" }
interface UiMessage { ...; mentions?: UiMention[]; attachments?: UiAttachment[] }
```

`previewUrl` is transient on the in-memory message for just-sent turns only; reloaded history renders file chips without thumbnails.

### Send payload and safe send

```ts
interface SendPayload { text: string; mentions: MentionInput[]; attachments: AttachmentInput[] }
type SendResult = { ok: true } | { ok: false; error: string };
send(payload): Promise<SendResult>
```

- Validation order (all before any state mutation): streaming guard → payload emptiness (text or ≥1 ready attachment) → provider → model. Rejections return `{ok:false, error}` and leave the store untouched; the composer keeps the draft and shows the error (existing banner + toast).
- On `{ok:true}` the composer clears its draft/tray. Note bodies are resolved by the composer before calling `send` (as today); read failures mark the mention with an inline warning instead of silently sending `""` (the mention keeps its chip; the hidden context notes `không đọc được ghi chú`).

### LLM content construction (`payload.ts`, pure)

- Mentions: hidden context blocks appended to the user text, as today (`MAX_CONTEXT_CHARS = 8000` per note), plus a per-send global budget of 48,000 chars across mentions + documents (truncate the last block and note the truncation).
- Documents: extracted text appended as `[File: originalName]\n---\n<text ≤20k chars>`.
- Images: the wire message becomes OpenAI content parts — `[{type:"text", text}, {type:"image_url", image_url:{url: previewUrl}}...]`. Text-only messages stay plain strings (backward compatible with every provider, including non-vision).
- `ChatMessage.content` in `openai.ts` widens to `string | ContentPart[] | null`. `streamChat`/`runAgent` pass it through untouched.

### Run ownership

- Module-level `Map<runId, AbortController>` plus the current run id captured per send.
- `stop()` aborts the current run's controller only.
- The `finally` block flips `status` and persists **only if its run id is still the active one** — a stopped-then-superseded run does not clobber a newer send.
- `send` while streaming still returns `{ok:false}` (no queueing).

### Retry from message metadata

`retryLast()` reads the last user message's `content`, `mentions`, `attachments`; re-resolves note bodies by id and re-reads attachment files from the attachments dir (re-prepare images, re-extract documents). `lastMentions` global is deleted.

### Persistence

`ChatMessageDto` (Rust + TS) gains optional `mentions`, `attachments`, `error` fields (`skip_serializing_if = "Option::is_none"`; old files parse via serde defaults). `persistChat` writes structured metadata and stops baking `⚠ error` into content. `loadChat` restores mention/attachment chips. Attachment **files** referenced by chats must survive orphan cleanup: the startup/command cleanup now also collects attachment names from `chats/*.json` (in addition to note bodies) before applying the 7-day grace rule.

### Attachment import (Rust)

Two new commands in `commands/attachments.rs`, reusing `notes_core::attachments` validation (allowlist, 25 MiB) and UUID naming — no note mutation:

- `import_attachment(srcPath) -> StoredFile` — for file-dialog paths (`save_file` as today).
- `import_attachment_bytes(fileName, bytes) -> StoredFile` — for paste/drop `File` objects; new `notes_core::attachments::save_bytes(dir, name, bytes)` helper with the same checks (extension from `fileName`, size from `bytes.len()`).

Extraction (`extract_attachment_text`) caps at 20,000 chars in the frontend pipeline (today's 400k Rust cap stays as the outer bound). Image pipeline (`prepare_attachment_image`) unchanged.

### Interaction spec

- **Triggers:** `@` opens the notes popover when the character before it is the start of text, whitespace, or any non-alphanumeric character that is not part of a longer token — concretely `@` triggers unless directly preceded by `[A-Za-z0-9_]` (so emails/identifiers like `user@host` don't trigger, `(@note`, `—@note`, text-start and space-prefixed all do). The query extends until whitespace or another `@`. Popover: fuzzy-ranked, max 8, excluding notes already tokenized in the draft. ArrowUp/Down wrap, Enter/Tab insert, Escape dismisses until the query changes.
- **Keyboard:** Enter sends (when no popover), Shift+Enter newline, IME-composed Enter never sends, Backspace on/next to a token deletes the whole token.
- **Paste:** clipboard files/images → attachments (prevent default); plain text pastes normally; pasted text > 2,000 chars becomes a `.txt` attachment "Văn bản đã dán" (ZCode behavior, threshold chosen to be conservative).
- **Drag/drop:** external files over the composer/panel show a "Thả file để đính kèm" overlay; drop imports them. Dragging text selections inside the editor behaves natively.
- **Toolbar:** paperclip (file dialog, multi-select via existing Tauri dialog), `@` button inserts the trigger char at the caret, context count chip ("2 file · 1 ghi chú"), send/stop as today (send enabled when text or ready attachment exists).
- **Side-panel quick-add** of the current note becomes a token insertion through the same editor API.
- **UI copy stays Vietnamese; visual style reuses existing tokens** (`bg-composer`, `border-composer-border`, `popover`, `accent`…) — the ZCode *structure*, not a visual clone.

## Error handling

- Import failures (bad type, >25 MiB) mark the tray item `error` with the backend message and a remove button; they never block sending other items.
- Provider/model validation failures return `{ok:false}`; composer shows the existing error banner + toast and keeps the draft.
- Mention read failure: inline warning chip state (message-scoped), model context notes the failure.
- Persistence stays best-effort (console.error, no user toast) per the original design constraints.

## Testing

- **Pure units:** `payload.ts` (parts, caps, budgets, doc text), generalized `activeTriggerQuery` (bare `@`, punctuation adjacency, whitespace, caret positions).
- **composerStore:** import happy/error paths (mock `invoke`), per-chat isolation, draft restore skips `previewUrl`, accepted-send clears the draft.
- **chatStore:** validation returns `{ok:false}` without mutation; message metadata; run-race (stop → immediate resend); retry re-reads from message metadata; persistence round-trip with chips; old-session JSON still loads. Existing `send(text, mentions)` call sites/tests migrate to the payload object.
- **Components (jsdom):** tray render/remove/error, toolbar states, send disabled logic, popover rendering with an injected query, `setText`/focus handle. Full Lexical caret interaction is not covered in jsdom (no layout); the plugin's query→insert path is covered via the pure helpers + a thin adapter.
- **Rust:** DTO round-trip with new optional fields; `save_bytes` validation (allowlist, size, uuid naming); chat-attachment refs included in orphan cleanup.
- Gates: `npm test`, `npm run build`, `cargo test --workspace` must pass.

## Migration & compatibility

- Old chats (no metadata fields) load as before — chips simply absent.
- Old drafts (none persisted today) — non-issue.
- `mentionQuery` export is replaced by `activeTriggerQuery` (no external consumers; no Composer tests existed).
- ModelPicker work (committed prior) is untouched except `ChatPanel` composer wiring.

## Relationship to the Phase 5–7 plan

This refactor implements the composer-side of Phase 5's "chat attachments" task (paperclip, paste, drop, image parts, chips, structured `ChatMessage.content`) and restructures the composer so Phase 6 skills (`slashQuery`, skill chips) plug into the existing trigger/token infrastructure. Media management UI and agent media tools remain in their own tasks.
