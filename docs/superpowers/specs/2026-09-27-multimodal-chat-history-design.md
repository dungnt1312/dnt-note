# Multimodal Chat History Design

## Goal

Keep prior user-turn context available to the model on ordinary follow-up messages, including images, extracted documents, and note mentions, without persisting image data URLs or document bodies in chat JSON.

This replaces the composer-refactor non-goal that degraded prior attachment turns to plain text.

## Scope

Included:

- Reconstruct every prior user message before each agent run.
- Reuse transient image previews and document text while they are still in memory.
- Re-read stored image/document files by their persisted attachment name after session reload.
- Re-read mentioned notes so a follow-up receives current note content.
- Preserve each attachment/context item on the user turn where it originated.
- Add deterministic text fallbacks when historical context cannot be read.
- Make editor-selection snippets durable stored document attachments so reference-only reconstruction also works for them.
- Keep history preparation abortable and owned by the originating chat/run.
- Cover live follow-ups, image-only turns, loaded sessions, retries, cancellation, and missing files with tests.

Excluded:

- Persisting base64 image data or extracted document bodies.
- Persisting the provider-specific wire payload.
- Redesigning assistant tool-call/tool-result history across separate agent runs.
- Adding provider/model capability discovery.
- Rehydrating legacy unsent composer drafts whose attachment references are already empty; that is a separate migration/lifecycle concern.

## Architecture

### Historical user-message reconstruction

Before `send` mutates chat state, it asynchronously converts the existing `UiMessage[]` into `ChatMessage[]`.

Assistant messages remain plain text.

Each user message is reconstructed from its stored display text plus its message-bound mentions and attachments:

1. Mentions are read by note id. A read failure retains the mention and marks it failed so the hidden context says the note could not be read.
2. Image attachments reuse `previewUrl` when present. Otherwise `attachmentsApi.prepareImage(name)` recreates the transient data URL.
3. Document attachments reuse `text` when present. Otherwise `attachmentsApi.extractText(name)` recreates the bounded text extract.
4. The resolved inputs are passed through `buildRequestUserMessage`, preserving the same content-part and context-budget rules as a current turn.

The reconstruction helper is independent of Zustand mutation so it can be tested directly through `send` mocks.

### Failure fallback

Historical context restoration must not abort a new message merely because one old file or note is unavailable.

- Failed mention: existing `failed` behavior produces `(không đọc được ghi chú)`.
- Failed image: append `[Image unavailable: <originalName>]` to that historical turn's text.
- Failed document: append `[File unavailable: <originalName>]` to that historical turn's text.

Fallback markers are model-facing only. They do not alter the visible message or persisted session.

An image-only historical turn therefore never degrades to an empty user message: it contains either the reconstructed `image_url` part or an explicit unavailable marker.

### Persistence

Chat persistence remains reference-based:

- Keep `id`, stored `name`, original name, size, and kind.
- Continue excluding image data URLs and extracted document text.
- Keep the existing attachment-reference cleanup behavior so files referenced by saved chats remain protected.

No TypeScript or Rust DTO migration is required.

### Request ordering and state safety

History reconstruction happens after provider/model validation but before adding the new user and placeholder assistant messages. The store claims run ownership and enters its busy state before awaiting reconstruction, preventing a second send from racing the first. Attachment/note promises are raced against the run's abort signal, so Stop or switching chats can end preparation without waiting for a slow native read.

Before mutating messages, the run verifies its operation ownership and source chat id still match. All long chat mutations use one atomic FIFO operation lease; send/retry acquire immediately or reject busy, while navigation/rename/delete queue behind the current lease. Once accepted, the operation remains busy through chat persistence. Failed saves retain an in-memory dirty session snapshot and surface an error; subsequent send/navigation retries that exact snapshot under the same lease before proceeding. Navigation aborts the active lease and acquires the next lease before replacing the visible chat, so an accepted source turn is persisted even when the user immediately switches sessions. Session loads use a generation token and abortable waits; stale responses cannot overwrite newer navigation. Rename and delete operations serialize behind active runs, preventing stale load-modify-save or deleted-session recreation.

If an unexpected reconstruction-level failure escapes the per-item fallbacks, `send` returns `{ok:false}`, leaves the conversation unchanged, and the composer retains its draft.

Retry uses the same resolver with forced attachment refresh and transfers the same FIFO lease directly from preparation into re-send/persistence, so queued rename/delete operations cannot observe its temporary truncated state. Refresh failure removes stale transient `previewUrl`/`text`, keeps attachment identity metadata, and emits the model-facing fallback. Retry truncation/rollback is applied only while the exact chat/message snapshot is still current. Delete evaluates whether its target is currently displayed only after acquiring its lease, and a later navigation cannot cancel an already confirmed backend deletion.

The composer locks locally while resolving note mentions, then revalidates chat id, editor state, and attachment ids/status before calling the store. `ChatPanel` keeps one Composer instance mounted across the empty→message transition. A successful send is consumed by editor snapshot and attachment ids instead of clearing the whole draft. Text, attachments, or snippets added while the accepted request is running remain in the next draft; late import completions cannot recreate a removed/cleared attachment.

The historical messages retain their original order. The newly built current-turn message is appended last and the existing agent loop receives the resulting array.

### Durable snippets

Editor-selection snippets and model context blocks are clipped by Unicode code point rather than UTF-16 code unit. Snippets are imported as UTF-8 Markdown bytes under the safe basename `chat-snippet.md`. The display name remains `originalName`, while the generated stored name is persisted like any other document attachment. Draft persistence drops transient image previews and extracted document text whenever a stored name exists; Composer restores them lazily from that reference after hydration. Legacy virtual snippets with `name: ""` and inline text are materialized into stored files on restore. Identical ready/importing snippets deduplicate, sending is disabled while any import/restore is in flight, and async completion updates only an attachment that still exists.

## Testing

Regression coverage will verify:

1. A live image remains an `image_url` part on the next turn.
2. An image-only prior turn does not become an empty string.
3. A loaded session calls `prepareImage` with the stored name and sends the reconstructed image.
4. Historical documents and mentions are reconstructed on follow-up.
5. Missing historical files produce explicit text fallback markers without blocking the new send or removing attachment metadata.
6. Stop and chat switching cancel preparation without leaking messages; retry cannot restore a stale chat snapshot.
7. Editor-selection snippets receive a stored filename and cannot be sent while importing.
8. Persisted JSON still excludes base64 previews and extracted document text.
9. Existing chat-store, payload, full unit-test, and production build checks pass.

## Compatibility

Text-only conversations preserve their current request shape. Providers receive multipart content only for user turns that contain successfully reconstructed images. No provider adapter changes are needed because the OpenAI-compatible serializer already forwards content arrays unchanged.
