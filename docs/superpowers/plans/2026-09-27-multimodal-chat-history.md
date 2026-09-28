# Multimodal Chat History Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reconstruct message-bound images, documents, and note mentions in prior user turns so ordinary follow-ups and reloaded sessions retain multimodal context.

**Architecture:** Add an asynchronous history builder beside `chatStore` that resolves each historical user message from transient in-memory data or its persisted attachment/note reference, then delegates wire formatting to `buildRequestUserMessage`. Keep persistence reference-only and degrade individual unreadable resources into explicit model-facing text markers without mutating the displayed session.

**Tech Stack:** TypeScript 5.9, Zustand 5, Vitest 3, Tauri attachment/note APIs, OpenAI-compatible content parts.

## Global Constraints

- Do not persist image data URLs, extracted document bodies, or provider-specific message payloads.
- Do not change the TypeScript or Rust chat persistence schema.
- Preserve the original ordering and turn association of messages and attachments.
- A missing historical resource must not block a new send.
- Keep assistant history plain text; tool-call persistence is outside this change.
- Preserve unrelated uncommitted changes in the working tree.
- Do not commit unless the user explicitly asks.

---

### Task 1: Lock the expected historical-context behavior with tests

**Files:**
- Modify: `src/lib/store/chatStore.test.ts:102-246`

**Interfaces:**
- Consumes: existing `useChatStore.send`, mocked `runAgent`, `notesApi.notes.read`, `attachmentsApi.prepareImage`, and `attachmentsApi.extractText`.
- Produces: regression expectations for live image history, image-only turns, loaded-session reconstruction, document/mention reconstruction, and unavailable-file fallback.

- [ ] **Step 1: Replace the current degradation assertion with a live image-history assertion**

Send an image on turn one, then a text follow-up. Capture the second `runAgent` invocation and assert its first historical message has content parts containing the original `image_url`.

- [ ] **Step 2: Add an image-only historical-turn case**

Send `{ text: "", attachments: [image] }`, then follow up. Assert the historical user content is an array containing an `image_url`, rather than an empty string.

- [ ] **Step 3: Add a loaded-session reconstruction case**

Mock `loadChat` with attachment metadata only, call `loadChat`, then `send`. Assert `attachmentsApi.prepareImage("u.png")` runs and the historical request contains the returned data URL.

- [ ] **Step 4: Add document and mention reconstruction assertions**

Create a prior user message with a mention and document. On follow-up, assert `notesApi.notes.read(id)` and `attachmentsApi.extractText(name)` are called and their fresh content appears in that historical message.

- [ ] **Step 5: Add missing-resource fallback assertions**

Reject `prepareImage` and `extractText` for historical attachments, send a follow-up, and assert the request contains `[Image unavailable: x.png]` and `[File unavailable: d.pdf]` while the current message is still sent.

- [ ] **Step 6: Run the focused tests and verify RED**

Run:

```bash
npm test -- --run src/lib/store/chatStore.test.ts
```

Expected: the new historical-context assertions fail because `send` currently maps history to `m.content` only.

---

### Task 2: Implement historical message reconstruction

**Files:**
- Modify: `src/lib/store/chatStore.ts:77-161`

**Interfaces:**
- Consumes: `UiMessage[]`, `notesApi.notes.read(id)`, `attachmentsApi.prepareImage(name)`, `attachmentsApi.extractText(name)`, `buildRequestUserMessage(text, mentions, attachments)`.
- Produces: `buildRequestHistory(messages: UiMessage[]): Promise<ChatMessage[]>` (module-local) and model-facing fallback text for unavailable attachments.

- [ ] **Step 1: Import the wire message type**

Add `import type { ChatMessage } from "../llm/openai";` so the history builder has an explicit return type.

- [ ] **Step 2: Add a per-user-message resolver**

Implement a module-local async helper that:

- Resolves mention bodies with `notesApi.notes.read`; failures become `{ body: "", failed: true }`.
- Reuses image `previewUrl` or calls `attachmentsApi.prepareImage(name)`.
- Reuses document `text` or calls `attachmentsApi.extractText(name)` and clips it to `MAX_DOC_CHARS`.
- Collects failed attachment markers without changing the stored `UiMessage`.
- Calls `buildRequestUserMessage` using the visible text plus any fallback markers.

Use these exact marker formats:

```ts
`[Image unavailable: ${attachment.originalName}]`
`[File unavailable: ${attachment.originalName}]`
```

- [ ] **Step 3: Add the ordered history builder**

Iterate historical messages sequentially. Map assistant messages to `{ role: "assistant", content: message.content }`; await user-message reconstruction. Exclude messages marked with `error`, matching current behavior.

- [ ] **Step 4: Use reconstructed history in `send`**

After provider/model validation and before state mutation, replace the plain-text map with:

```ts
const history = await buildRequestHistory(get().messages);
```

Keep `requestUser` construction and append ordering unchanged.

- [ ] **Step 5: Run the focused tests and verify GREEN**

Run:

```bash
npm test -- --run src/lib/store/chatStore.test.ts src/lib/chat/payload.test.ts
```

Expected: both files pass, including live follow-up, reload, and fallback cases.

---

### Task 3: Verify persistence and application compatibility

**Files:**
- Verify: `src/lib/store/chatStore.ts`
- Verify: `src/lib/store/chatStore.test.ts`
- Verify: `src/lib/chat/payload.ts`
- Verify: `src/lib/llm/openai.ts`
- Verify: `docs/superpowers/specs/2026-09-27-multimodal-chat-history-design.md`

**Interfaces:**
- Consumes: the implementation from Task 2.
- Produces: evidence that all unit tests and production type/build checks pass and that persistence remains reference-only.

- [ ] **Step 1: Confirm persistence regression coverage remains intact**

Ensure the existing test still asserts serialized chat JSON does not contain the image data URL and only includes attachment metadata.

- [ ] **Step 2: Run all frontend unit tests**

Run:

```bash
npm test -- --run
```

Expected: zero failed test files and zero failed tests.

- [ ] **Step 3: Run the production build**

Run:

```bash
npm run build
```

Expected: TypeScript exits cleanly and Vite completes the production bundle.

- [ ] **Step 4: Inspect the focused diff**

Run:

```bash
git diff --check
git diff -- src/lib/store/chatStore.ts src/lib/store/chatStore.test.ts docs/superpowers/specs/2026-09-27-multimodal-chat-history-design.md docs/superpowers/plans/2026-09-27-multimodal-chat-history.md
```

Expected: no whitespace errors and no changes outside the approved scope in the focused diff.

- [ ] **Step 5: Request a read-only code review**

Ask a reviewer to inspect async ordering, state mutation timing, resource fallback behavior, and test coverage. Resolve any important findings, then rerun Steps 2-4.
