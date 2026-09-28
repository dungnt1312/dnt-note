# Research Report: ZCode Chat Composer

**Researched:** 2026-09-27  
**Reference version:** ZCode 3.14.3 (2026-09-24)

## Executive summary

ZCode's composer is a structured Lexical editor, not a textarea with detached chips. Context references are atomic inline nodes carrying both display metadata and serialized prompt values. The same editor supports workspace context, skills, commands, agents, sessions, plugins, and whiteboards.

The key UX distinction is between **context** and **attachments**:

- Workspace files/folders are mentioned as contextual references.
- External files are uploaded as attachments.
- Dropping a workspace item says “Drop to mention this file or folder.”
- Dropping an external file says “Drop to add attachments.”

For DNT Note, the strongest lesson is not to copy every coding-specific category. Reuse the interaction model with a smaller domain model: note mentions, external attachments, skills, and optionally prior chat references.

## Research methodology

- Sources: installed ZCode 3.14.3 resources, official ZCode website, official changelog, official GitHub source, official v3.14.3 release.
- Recency: current through 2026-09-27.
- Scope: composer layout and behavior only—mentions/context, attachments, commands/skills, keyboard, model/mode controls, send/stop, errors, and draft persistence.
- Private conversation content was not inspected.

## Key findings

### 1. Editor architecture

ZCode uses a Lexical rich-text editor with a custom `PromptMentionNode` rather than a plain textarea. It provides APIs for inserting file, skill, slash-command, and generic mention nodes.

The editor:

- Expands from a compact minimum height to a bounded maximum height.
- Scrolls internally after reaching its maximum height.
- Persists rich editor state, not only plain text.
- Treats references as atomic keyboard-aware tokens.
- Preserves tokens through editor updates and draft restoration.

### 2. Context and mentions

Observed mention categories include:

- Files
- Skills
- Commands
- Subagents
- Sessions
- Plugins
- Whiteboards

The public UI says “Use @ to add context.” Mention results can search workspace files, plugins, and conversations. The source model supports the broader categories listed above.

Each reference contains:

- Stable ID
- Category
- User-facing label
- Model-facing value
- Canonical markdown serialization

This prevents the current DNT Note problem where visible draft text and selected mention chips are separate, loosely synchronized state.

### 3. Attachments

ZCode supports:

- Single and multiple file selection
- Direct image paste
- Long pasted text converted into a “Pasted text” attachment
- External file drag/drop
- Local preview URLs
- Image, video, and PDF previews
- Upload progress, retry, failure, and completion states

It separates two drop intents:

| Source | Result |
|---|---|
| Workspace file/folder | Add an inline context mention |
| External OS file | Add an uploaded attachment |

This distinction is important for DNT Note: an existing note should be context; a local PDF or image should be an attachment.

### 4. Commands and skills

ZCode separates three discovery paths:

- `/` for capabilities and commands
- `$` for skills
- `@` for context

Slash and mention panels are anchored to the composer caret/container. Search results are grouped, searchable, and keyboard navigable. Commands and skills are inserted as atomic editor nodes.

For DNT Note, supporting all three trigger characters may be unnecessary. A simpler first version can use:

- `@` for notes
- `/` for skills/actions
- `+` or paperclip for attachments

### 5. Keyboard behavior

ZCode's defaults are:

- Enter: send
- Shift+Enter: newline

Both are remappable. The editor also:

- Does not send during IME composition.
- Supports keyboard deletion around atomic mention nodes.
- Clears only after an accepted submission.
- Refocuses after successful send.
- Allows custom send and newline shortcuts.

The “clear only after accepted submission” behavior directly addresses DNT Note's current draft-loss bug when provider/model validation rejects a send.

### 6. Send, queue, and stop

The primary action becomes Stop during an active response. ZCode can queue a follow-up draft while a response is running and can also send a follow-up immediately through a separate action.

Stopping affects the current response; queued content remains available. This is stronger than DNT Note's current global abort controller and immediate idle transition, which can race with a new send.

Queueing is useful but not required for the first refactor. Correct run ownership and draft preservation are higher priority.

### 7. Composer controls

ZCode places compact controls near the editor for:

- Attachment/action menu
- Model selection
- Permission/execution mode
- Reasoning level
- Context usage
- Computer Use when available
- Send/stop

The model selection stores provider, model, and optional reasoning level. Controls become unavailable when changing them would conflict with an active task.

DNT Note should retain only domain-relevant controls: attachment menu, model selector, and send/stop. Permission mode and reasoning level should remain out of scope unless the application gains those concepts.

### 8. Draft persistence

ZCode persists scoped composer state, including:

- Plain text
- Rich editor JSON
- Mentions
- Mode
- Model selection
- Permission transition state

DNT Note does not need all of this. Persisting draft text plus structured context items per chat is enough to prevent accidental loss during navigation or validation failures.

## Recommended adaptation for DNT Note

Adopt the ZCode interaction model but reduce its scope:

1. Use a structured composer document with text and atomic inline references.
2. Use `@` only for notes in the first iteration.
3. Use `/` for skills when Phase 6 skills are introduced.
4. Use a paperclip/plus menu, paste, and external drag/drop for files.
5. Render attachment previews in a tray inside the composer shell; keep note and skill references inline in the text flow.
6. Distinguish context from attachments in both the data model and UI.
7. Resolve and validate before clearing the draft.
8. Bind retry context and attachments to each message rather than module globals.
9. Persist structured message metadata so history reload retains references and attachment chips.
10. Track each generation with a run ID and owned abort controller.

## What not to copy

- Coding-specific categories such as plugins, agents, and whiteboards.
- Full permission-mode and Computer Use controls.
- Upload/session queue complexity before DNT Note needs remote transfers.
- Every ZCode slash command.
- A full configurable shortcut system in the initial refactor.

## Sources

### Official public sources

- [ZCode product site](https://zcode.z.ai/)
- [ZCode changelog](https://zcode.z.ai/changelog)
- [ZCode GitHub repository](https://github.com/zai-org/ZCode)
- [ZCode v3.14.3 release](https://github.com/zai-org/ZCode/releases/tag/v3.14.3)
- [ConversationComposer.tsx](https://github.com/zai-org/ZCode/blob/main/packages/ui/src/v4/ConversationComposer.tsx)
- [LexicalChatInput.tsx](https://github.com/zai-org/ZCode/blob/main/packages/ui/src/LexicalChatInput.tsx)
- [SlashCommandPlugin.tsx](https://github.com/zai-org/ZCode/blob/main/packages/ui/src/SlashCommandPlugin.tsx)
- [MentionPlugin.tsx](https://github.com/zai-org/ZCode/blob/main/packages/ui/src/mentions/MentionPlugin.tsx)
- [PromptMentionNode.ts](https://github.com/zai-org/ZCode/blob/main/packages/ui/src/mentions/nodes/PromptMentionNode.ts)
- [Shortcut definitions](https://github.com/zai-org/ZCode/blob/main/packages/shared/src/shortcutCommands.ts)

### Installed-resource evidence

- `C:\Users\devdu\AppData\Local\Programs\ZCode\resources\app.asar`
- `app.asar:/out/metadata/build-meta.json`
- `app.asar:/out/renderer/assets/styles-DEELZGp2.js`
- `app.asar:/out/renderer/assets/styles-C8Nayk5k.css`
- `C:\Users\devdu\AppData\Local\Programs\ZCode\resources\glm\packages\zcode-guide-plugin\skills\diagnosing-commands\SKILL.md`
- `C:\Users\devdu\AppData\Local\Programs\ZCode\resources\glm\packages\skill-creator-plugin\skills\skill-creator\SKILL.md`

## Unresolved questions

- Exact attachment size/type limits in current ZCode.
- Exact chip spacing, truncation, and removal affordance across platforms.
- Whether DNT Note should implement inline atomic tokens immediately or first use a hybrid textarea plus synchronized context tray.
