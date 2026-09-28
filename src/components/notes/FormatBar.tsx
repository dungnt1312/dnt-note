import type { ReactNode } from "react";
import type { EditorView } from "@codemirror/view";
import {
  Code,
  List,
  ListChecks,
  ListOrdered,
  Link2,
  Minus,
  MoreHorizontal,
  Quote,
  SquareCode,
  Table,
} from "lucide-react";
import {
  applyFormat,
  insertBlock,
  insertLink,
  setHeading,
  toggleLinePrefix,
  toggleWrap,
} from "../../lib/editor/formatting";
import { useT } from "../../lib/i18n";
import { cn } from "../../lib/utils";
import { ToolbarDivider } from "../ui/Button";
import { Menu, MenuItem } from "../ui/Menu";

function ToolButton({
  label,
  onClick,
  children,
  className,
}: {
  label: string;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      title={label}
      // Keep the editor selection: don't steal focus on mousedown.
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className={cn(
        "flex h-7 min-w-[30px] items-center justify-center rounded-[7px] px-1.5 text-fg-secondary transition-colors hover:bg-hover hover:text-fg",
        className,
      )}
    >
      {children}
    </button>
  );
}

interface FormatBarProps {
  view: EditorView | null;
  stats: string;
}

/** Formatting toolbar: ¶ H1 H2 H3 | B I S | lists | quote link code ⋯ — stats on the right. */
export function FormatBar({ view, stats }: FormatBarProps) {
  const t = useT();
  const run = (build: Parameters<typeof applyFormat>[1]) => applyFormat(view, build);
  const text = "text-callout font-semibold";
  return (
    <div role="toolbar" aria-label={t("notes.formatToolbar")} className="flex h-10 shrink-0 items-center gap-0.5 px-3">
      <ToolButton label={t("notes.formatParagraph")} className={text} onClick={() => run((s) => setHeading(s, 0))}>
        ¶
      </ToolButton>
      <ToolButton label={t("notes.formatHeading", { n: 1 })} className={text} onClick={() => run((s) => setHeading(s, 1))}>
        H1
      </ToolButton>
      <ToolButton label={t("notes.formatHeading", { n: 2 })} className={text} onClick={() => run((s) => setHeading(s, 2))}>
        H2
      </ToolButton>
      <ToolButton label={t("notes.formatHeading", { n: 3 })} className={text} onClick={() => run((s) => setHeading(s, 3))}>
        H3
      </ToolButton>
      <ToolbarDivider />
      <ToolButton label={t("notes.formatBold")} className="text-callout font-bold" onClick={() => run((s) => toggleWrap(s, "**"))}>
        B
      </ToolButton>
      <ToolButton label={t("notes.formatItalic")} className="font-serif text-[14px] italic" onClick={() => run((s) => toggleWrap(s, "*"))}>
        I
      </ToolButton>
      <ToolButton label={t("notes.formatStrikethrough")} className="text-callout line-through" onClick={() => run((s) => toggleWrap(s, "~~"))}>
        S
      </ToolButton>
      <ToolbarDivider />
      <ToolButton label={t("notes.formatBulletList")} onClick={() => run((s) => toggleLinePrefix(s, "bullet"))}>
        <List size={15} aria-hidden="true" />
      </ToolButton>
      <ToolButton label={t("notes.formatNumberedList")} onClick={() => run((s) => toggleLinePrefix(s, "numbered"))}>
        <ListOrdered size={15} aria-hidden="true" />
      </ToolButton>
      <ToolButton label={t("notes.formatChecklist")} onClick={() => run((s) => toggleLinePrefix(s, "task"))}>
        <ListChecks size={15} aria-hidden="true" />
      </ToolButton>
      <ToolbarDivider />
      <ToolButton label={t("notes.formatQuote")} onClick={() => run((s) => toggleLinePrefix(s, "quote"))}>
        <Quote size={14} aria-hidden="true" />
      </ToolButton>
      <ToolButton label={t("notes.formatLink")} onClick={() => run(insertLink)}>
        <Link2 size={15} aria-hidden="true" />
      </ToolButton>
      <ToolButton label={t("notes.formatInlineCode")} onClick={() => run((s) => toggleWrap(s, "`"))}>
        <Code size={15} aria-hidden="true" />
      </ToolButton>
      <Menu
        align="start"
        width={200}
        trigger={(p) => (
          <button
            type="button"
            {...p}
            aria-label={t("notes.insertMore")}
            title={t("notes.insertMore")}
            className="flex h-7 w-[30px] items-center justify-center rounded-[7px] text-fg-secondary hover:bg-hover hover:text-fg"
          >
            <MoreHorizontal size={15} aria-hidden="true" />
          </button>
        )}
      >
        <MenuItem icon={<SquareCode size={14} />} onSelect={() => run((s) => insertBlock(s, "code"))}>
          {t("notes.insertCodeBlock")}
        </MenuItem>
        <MenuItem icon={<Table size={14} />} onSelect={() => run((s) => insertBlock(s, "table"))}>
          {t("notes.insertTable")}
        </MenuItem>
        <MenuItem icon={<Minus size={14} />} onSelect={() => run((s) => insertBlock(s, "rule"))}>
          {t("notes.insertRule")}
        </MenuItem>
      </Menu>
      <span className="ml-auto truncate pl-3 text-footnote tabular-nums text-fg-tertiary">{stats}</span>
    </div>
  );
}
