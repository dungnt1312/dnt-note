import { useEffect, useState } from "react";
import { api, type Note } from "../../lib/api/notes";
import { useT, localeTag } from "../../lib/i18n";
import ReactMarkdown from "react-markdown";
import remarkGfm from "remark-gfm";
import { initAttachmentsDir, markdownUrlTransform } from "../../lib/media/attachmentUrl";

/** Minimal print/export view rendered for `?print=<id>` windows. */
export function PrintView({ noteId }: { noteId: string }) {
  const t = useT();
  const [note, setNote] = useState<Note | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    // Attachment URLs need the resolved dir before the first render.
    initAttachmentsDir()
      .then(() => api.notes.read(noteId))
      .then(setNote)
      .catch((e) => setError(String(e)));
  }, [noteId]);

  useEffect(() => {
    if (!note) return;
    const t = setTimeout(() => window.print(), 600);
    return () => clearTimeout(t);
  }, [note]);

  if (error) return <p style={{ padding: 24 }}>{t("notes.printError", { error })}</p>;
  if (!note) return <p style={{ padding: 24 }}>{t("notes.loading")}</p>;

  const date = new Date(note.updated).toLocaleString(localeTag());

  return (
    <div className="print-root">
      <h1>{note.title}</h1>
      <div className="print-meta">
        DNT Note · {date}
        {note.tags.length > 0 && <> · {note.tags.join(", ")}</>}
      </div>
      <hr />
      <div className="print-body">
        <ReactMarkdown remarkPlugins={[remarkGfm]} urlTransform={markdownUrlTransform}>{note.body}</ReactMarkdown>
      </div>
    </div>
  );
}
