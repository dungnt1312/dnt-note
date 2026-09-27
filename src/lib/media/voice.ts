const pad = (n: number) => String(n).padStart(2, "0");

/** `ghi-am-YYYYMMDD-HHmmss.webm` in local time. */
export function voiceFileName(d: Date = new Date()): string {
  const date = `${d.getFullYear()}${pad(d.getMonth() + 1)}${pad(d.getDate())}`;
  const time = `${pad(d.getHours())}${pad(d.getMinutes())}${pad(d.getSeconds())}`;
  return `ghi-am-${date}-${time}.webm`;
}

/** Milliseconds → mm:ss. */
export function formatElapsed(ms: number): string {
  const total = Math.max(0, Math.floor(ms / 1000));
  return `${pad(Math.floor(total / 60))}:${pad(total % 60)}`;
}

/** Transcript → markdown blockquote; empty lines kept as bare ">". */
export function formatTranscript(text: string): string {
  const trimmed = text.trim();
  if (!trimmed) return "";
  return trimmed
    .split(/\r?\n/)
    .map((l) => l.trim())
    .map((l) => (l ? `> ${l}` : ">"))
    .join("\n");
}

/** Voice link: `[🎙 display](attachments/…)` built from the canonical link. */
export function voiceLinkFor(link: string): string {
  return link.replace(/^\[/, "[🎙 ");
}
