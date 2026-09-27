import { Copy, Sparkles } from "lucide-react";
import { ContextMenu } from "../ui/ContextMenu";
import { MenuItem } from "../ui/Menu";

interface EditorContextMenuProps {
  x: number;
  y: number;
  hasSelection: boolean;
  onClose: () => void;
  /** "Gửi vào Trợ lý AI" — attach the selection as a virtual snippet. */
  onSelection: () => void;
  /** "Hỏi AI về ghi chú này" — insert the whole note as an @token. */
  onWholeNote: () => void;
  /** Plain copy of the selection (replaces the blocked native menu). */
  onCopy: () => void;
}

/** Right-click menu inside the note editor: hands context to the assistant. */
export function EditorContextMenu({
  x,
  y,
  hasSelection,
  onClose,
  onSelection,
  onWholeNote,
  onCopy,
}: EditorContextMenuProps) {
  return (
    <ContextMenu x={x} y={y} onClose={onClose}>
      {hasSelection ? (
        <>
          <MenuItem icon={<Sparkles size={14} />} onSelect={onSelection}>
            Gửi vào Trợ lý AI
          </MenuItem>
          <MenuItem icon={<Copy size={14} />} onSelect={onCopy}>
            Sao chép
          </MenuItem>
        </>
      ) : (
        <MenuItem icon={<Sparkles size={14} />} onSelect={onWholeNote}>
          Hỏi AI về ghi chú này
        </MenuItem>
      )}
    </ContextMenu>
  );
}
