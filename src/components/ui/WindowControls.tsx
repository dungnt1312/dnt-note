import { getCurrentWindow } from "@tauri-apps/api/window";
import { isTauri } from "../../lib/env";

function Glyph({ d }: { d: string }) {
  return (
    <svg aria-hidden="true" width="10" height="10" viewBox="0 0 10 10" fill="none" stroke="currentColor" strokeWidth="1">
      <path d={d} />
    </svg>
  );
}

const btn =
  "flex h-full w-[46px] items-center justify-center text-fg-secondary transition-colors hover:bg-hover hover:text-fg";

/** Windows caption buttons, drawn flush with the 52px header they sit in. */
export function WindowControls() {
  if (!isTauri) return null;
  const win = getCurrentWindow();
  return (
    <div className="-mr-3 ml-1 flex h-[52px] shrink-0 self-start">
      <button type="button" aria-label="Thu nhỏ" title="Thu nhỏ" className={btn} onClick={() => void win.minimize()}>
        <Glyph d="M0 5.5h10" />
      </button>
      <button
        type="button"
        aria-label="Phóng to / Khôi phục"
        title="Phóng to"
        className={btn}
        onClick={() => void win.toggleMaximize()}
      >
        <Glyph d="M0.5 0.5h9v9h-9z" />
      </button>
      <button
        type="button"
        aria-label="Đóng"
        title="Đóng"
        className={`${btn} hover:!bg-[#c42b1c] hover:!text-white`}
        onClick={() => void win.close()}
      >
        <Glyph d="M0.5 0.5l9 9M9.5 0.5l-9 9" />
      </button>
    </div>
  );
}
