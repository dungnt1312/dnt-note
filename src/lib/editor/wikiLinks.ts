import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { autocompletion, type CompletionContext, type CompletionResult } from "@codemirror/autocomplete";
import { fuzzyRank } from "../fuzzy";

export interface WikiLink {
  from: number;
  to: number;
  target: string;
  alias?: string;
}

export interface WikiLinkOptions {
  titles: () => string[];
  onOpen: (target: string) => void;
}

const WIKI_RE = /\[\[([^[\]\n|]+)(?:\|([^[\]\n]*))?\]\]/g;

/** Ranges covered by fenced code blocks and inline code spans. */
function codeRanges(text: string): [number, number][] {
  const out: [number, number][] = [];
  const fence = /^(```|~~~)[^\n]*\n[\s\S]*?(?:^\1[^\n]*$|(?![\s\S]))/gm;
  let m: RegExpExecArray | null;
  while ((m = fence.exec(text))) {
    out.push([m.index, m.index + m[0].length]);
    if (m[0].length === 0) fence.lastIndex++;
  }
  const inline = /(`+)[^`\n][\s\S]*?\1/g;
  while ((m = inline.exec(text))) {
    const start = m.index;
    if (out.some(([a, b]) => start >= a && start < b)) continue;
    out.push([start, start + m[0].length]);
  }
  return out;
}

/** Find `[[Target]]` / `[[Target|alias]]` links, skipping code. */
export function parseWikiLinks(text: string): WikiLink[] {
  if (!text.includes("[[")) return [];
  const code = codeRanges(text);
  const links: WikiLink[] = [];
  WIKI_RE.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = WIKI_RE.exec(text))) {
    const from = m.index;
    const target = m[1].trim();
    if (!target) continue;
    if (code.some(([a, b]) => from >= a && from < b)) continue;
    const link: WikiLink = { from, to: from + m[0].length, target };
    const alias = m[2]?.trim();
    if (alias) link.alias = alias;
    links.push(link);
  }
  return links;
}

export const normTitle = (t: string) => t.trim().toLowerCase();

const linkMark = Decoration.mark({ class: "cm-wikilink" });
const missingMark = Decoration.mark({ class: "cm-wikilink cm-wikilink-missing" });

function buildDecos(view: EditorView, titles: () => string[]): DecorationSet {
  const known = new Set(titles().map(normTitle));
  const b = new RangeSetBuilder<Decoration>();
  for (const l of parseWikiLinks(view.state.doc.toString())) {
    b.add(l.from, l.to, known.has(normTitle(l.target)) ? linkMark : missingMark);
  }
  return b.finish();
}

/** Completion source: after `[[`, suggest note titles. */
export function wikiCompletionSource(titles: () => string[]) {
  return (ctx: CompletionContext): CompletionResult | null => {
    const m = ctx.matchBefore(/\[\[[^[\]\n|]*$/);
    if (!m) return null;
    const query = m.text.slice(2);
    const ranked = fuzzyRank(titles(), query, (t) => t).slice(0, 50);
    return {
      from: m.from + 2,
      filter: false,
      options: ranked.map(({ item }, i) => ({ label: item, apply: `${item}]]`, boost: -i })),
    };
  };
}

export function wikiLinks(opts: WikiLinkOptions): Extension[] {
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = buildDecos(view, opts.titles);
      }
      update(u: ViewUpdate) {
        // Titles can change without a doc change; cheap enough to rebuild on focus/viewport too.
        if (u.docChanged || u.viewportChanged || u.focusChanged) this.decorations = buildDecos(u.view, opts.titles);
      }
    },
    { decorations: (v) => v.decorations },
  );
  return [
    plugin,
    autocompletion({ override: [wikiCompletionSource(opts.titles)], icons: false }),
    EditorView.domEventHandlers({
      mousedown: (e, view) => {
        if (!(e.ctrlKey || e.metaKey) || e.button !== 0) return false;
        const pos = view.posAtCoords({ x: e.clientX, y: e.clientY });
        if (pos === null) return false;
        const link = parseWikiLinks(view.state.doc.toString()).find((l) => pos >= l.from && pos <= l.to);
        if (!link) return false;
        e.preventDefault();
        opts.onOpen(link.target);
        return true;
      },
    }),
  ];
}
