# DNT Note — Nguyên tắc thiết kế (Design Guidelines)

> Cập nhật: 2026-09-27 · Hệ token "Studio" (phong cách ChatGPT) · Áp dụng cho mọi surface: main, quick capture, print
> Liên quan: [code-standards](./code-standards.md) · [project-overview-pdr](./project-overview-pdr.md)

## 1. Hệ token "Studio" (`src/theme/tokens.css`)

- Toàn bộ màu/đế là **cặp biến `--studio-*` light/dark**; Tailwind v4 ánh xạ qua `@theme`
  thành utilities ngữ nghĩa. **Quy tắc: không dùng màu hex trực tiếp trong component.**

| Utility | Token nền | Dùng cho |
|---|---|---|
| `bg-app` / `text-fg` | nền app / chữ chính | Bề mặt chính |
| `text-fg-tertiary` | chữ phụ/mờ | meta, placeholder, hint |
| `border-hairline` | đường kẻ 1px | phân cách row, panel |
| `bg-composer` | nền composer/panel nổi | chat composer, popover |
| `shadow-popover` | đổ menu/popup | Menu, ContextMenu, dialog |
| `text-callout` | chữ nhấn nhỏ | callout, kbd hint |

- **Type scale cố định 7 bậc: 11 / 12 / 13 / 15 / 17 / 22 / 28px** — không tự đưa size khác.
- **Radii + shadow** lấy từ token (radii pill cho chip/button capsule, radius panel cho popover).
- Alias var legacy cho cửa sổ `print-*` và `quickcapture` tái dùng token mới.
- `.fade-x` chip mask để chip dài (mention, tag) mờ dần ở mép thay vì cắt cứng.
- Thin scrollbar mảnh toàn app; `user-select: text` trên inputs — **fix bug caret WebView2**
  (không bỏ dòng này).

## 2. Theming

- `ThemeProvider` (`src/components/theme/`): `light | dark | system`, persist localStorage;
  `system` theo `prefers-color-scheme`.
- Dark mode bật bằng class **`.dark` trên `<html>`**; mọi token có cặp giá trị tương ứng.
- Radio chọn theme trong Settings có **mini preview** (swatch) — ngoại lệ duy nhất được phép
  vẽ màu inline.

## 3. Layout chuẩn

| Vùng | Kích thước | Ghi chú |
|---|---|---|
| Cửa sổ main | 1280×800 (min 860×560), centered | `decorations: false` — titlebar tự vẽ |
| Sidebar | 264px | Brand + drag region, tab Notes/Assistant, search, chips tag |
| Header (ContentHeader) | 52px | **Drag region** + WindowControls |
| Chat docked | 384px | Cạnh editor trong section notes; biến thể `full` chiếm pane |
| Quick capture | 440×170 | Always-on-top, header kéo được |

- Bề mặt tầng: sidebar → header → content → popover (menu) → overlay (dialog) → toast.

## 4. Component primitives

- **Button** (`ui/Button.tsx`): `IconButton` 32/28px (tooltip + aria-label bắt buộc),
  `PillButton` accent/danger, `SecondaryButton` outlined + destructive, `Keycap`,
  `ToolbarDivider`.
- **Menu vs ContextMenu:** `Menu` neo trigger (z-index **40**); `ContextMenu` portal vào body
  neo theo cursor (z-index **50**) — dùng chung `MenuItem/MenuSeparator/MenuLabel/MenuGroup`;
  `MenuItem` hỗ trợ icon/hint/destructive/checked (`menuitemradio`).
- **Overlay** (`ui/Dialog.tsx`) xử lý mọi modality: backdrop, Esc, focus trap + restore,
  `data-autofocus`. `ConfirmDialog` dùng cho destructive (⚠️ nợ: default cancel "Hủy" chưa qua i18n).
- Menu điều hướng bàn phím: ↑↓ di chuyển, Enter chọn, Esc/Click-outside đóng — nhất quán cả
  Menu, ContextMenu, CommandPalette, MentionPlugin.

## 5. Accessibility (a11y)

- **ARIA roles** chuẩn theo vùng: `tablist` (tabs), `listbox` (mentions, model picker),
  `log` (chat stream), `toolbar` (FormatBar), `alertdialog` (xác nhận xóa), `menu/menuitem`.
- `aria-pressed` cho toggle, **`aria-live="polite"`** cho toast, `aria-label` trên hầu như mọi
  control icon-only.
- **Focus-visible ring** toàn cục (token a11y trong tokens.css); không xóa outline — thay bằng ring.
- **Reduced motion:** tôn trọng `prefers-reduced-motion` (animation rút gọn).
- **Target tối thiểu:** 32px (control chính) / 28px (control nhỏ) — khớp IconButton.

## 6. Iconography

- Bộ icon: **lucide-react** — không trộn bộ khác; kích thước theo type scale, stroke mặc định.
- **BrandMark**: logo SVG monogram **D/N** với folded-note mask ("Concept A") — dùng ở Sidebar,
  tray icon sinh từ `src-tauri/icons/dnt-note.svg`.

## 7. Copywriting (giọng tiếng Việt)

- Toàn bộ copy UI **tiếng Việt**, giọng trung tính – thân thiện, ngắn gọn; thuật ngữ kỹ thuật
  giữ tiếng Anh (MCP, model, provider…).
- **Kbd hints** trong label: "Undo · Ctrl Z", "Quick capture · Ctrl+Shift+N" — luôn dùng `Keycap`.
- **Empty-state** kèm suggestion chips cho phép hành động ngay (chat panel gợi ý câu hỏi đầu);
  không bao giờ để vùng trống không giải thích.
- Toast: một slot duy nhất bottom-centre, có action (vd "Undo"); lỗi hiển thị kèm cách xử lý.
- Copy agent/AI dùng ngôi "bạn"; tool mô tả tiếng Việt (cả agent tools lẫn MCP tools).

## 8. Lưu ý đặc thù WebView2

| Vấn đề | Cách xử lý hiện tại |
|---|---|
| Caret biến mất khi `user-select: none` toàn cục | `user-select: text` trên inputs/contenteditable trong tokens.css |
| Scrollbar to mặc định | Thin scrollbar styled toàn app |
| Chip/tag dài cắt cứng | `.fade-x` mask mờ dần ở mép |
| Focus ring không hiện trên contenteditable | Fix theme: outline ring cho composer editor (commit `9409cf1`) |
| Cửa sổ không decoration | Drag region 52px header + WindowControls caption Windows (đỏ khi hover close; no-op ngoài Tauri) |
| Nhiều cửa sổ dùng chung app | Route `?print=<id>` / `?quick=1` + alias CSS var legacy cho print & quick capture |
