import { RangeSetBuilder, type Extension } from "@codemirror/state";
import { Decoration, EditorView, ViewPlugin, type DecorationSet, type ViewUpdate } from "@codemirror/view";
import { markdownLanguage } from "@codemirror/lang-markdown";
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


/** Opening fence (<=3 spaces indent, >=3 backticks or tildes) on a line. */
function fenceOpen(line: string): string | null {
  const m = /^ {0,3}(`{3,}|~{3,})/.exec(line);
  return m ? m[1] : null;
}

function closesFence(line: string, fence: string): boolean {
  const m = /^ {0,3}(`+|~+)\s*$/.exec(line);
  return !!m && m[1][0] === fence[0] && m[1].length >= fence.length;
}

function scanLine(line: string, offset: number, out: WikiLink[]) {
  let i = 0;
  while (i < line.length) {
    if (line[i] === "`") {
      let run = 1;
      while (line[i + run] === "`") run++;
      // Look for a closing run of exactly the same length on this line.
      let j = i + run;
      let closed = -1;
      while (j < line.length) {
        if (line[j] !== "`") {
          j++;
          continue;
        }
        let r = 1;
        while (line[j + r] === "`") r++;
        if (r === run) {
          closed = j + r;
          break;
        }
        j += r;
      }
      i = closed >= 0 ? closed : i + run;
      continue;
    }
    if (line[i] === "[" && line[i + 1] === "[") {
      const close = line.indexOf("]]", i + 2);
      if (close >= 0) {
        const inner = line.slice(i + 2, close);
        if (!/[[\]]/.test(inner)) {
          const bar = inner.indexOf("|");
          const target = (bar >= 0 ? inner.slice(0, bar) : inner).trim();
          if (target) {
            const link: WikiLink = { from: offset + i, to: offset + close + 2, target };
            const alias = bar >= 0 ? inner.slice(bar + 1).trim() : "";
            if (alias) link.alias = alias;
            out.push(link);
            i = close + 2;
            continue;
          }
        }
      }
    }
    i++;
  }
}

/**
 * Find `[[Target]]` / `[[Target|alias]]` links. Skips fenced blocks
 * (CommonMark: indent <= 3, ``` or ~~~) and single-line inline code spans.
 * Mirrors notes-core `wiki::parse_wiki_targets` (shared vectors test).
 */
export function parseWikiLinks(text: string): WikiLink[] {
  if (!text.includes("[[")) return [];
  const links: WikiLink[] = [];
  let fence: string | null = null;
  let offset = 0;
  for (const line of text.split("\n")) {
    if (fence) {
      if (closesFence(line, fence)) fence = null;
    } else if ((fence = fenceOpen(line)) === null) {
      scanLine(line, offset, links);
    }
    offset += line.length + 1;
  }
  return links;
}

export const normTitle = (t: string) => t.trim().toLowerCase();

const linkMark = Decoration.mark({ class: "cm-wikilink" });
const missingMark = Decoration.mark({ class: "cm-wikilink cm-wikilink-missing" });

function buildDecos(view: EditorView, titles: () => string[]): DecorationSet {
  const known = new Set(titles().map(normTitle));
  const b = new RangeSetBuilder<Decoration>();
  const doc = view.state.doc;
  let last = -1;
  for (const r of view.visibleRanges) {
    // Parse from doc start so fence state is correct; only visible links are marked.
    const from = doc.lineAt(r.from).from;
    const to = doc.lineAt(r.to).to;
    const head = doc.sliceString(0, to);
    for (const l of parseWikiLinks(head)) {
      if (l.to <= from || l.from <= last) continue;
      b.add(l.from, l.to, known.has(normTitle(l.target)) ? linkMark : missingMark);
      last = l.from;
    }
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
    markdownLanguage.data.of({ autocomplete: wikiCompletionSource(opts.titles) }),
    autocompletion({ icons: false }),
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
