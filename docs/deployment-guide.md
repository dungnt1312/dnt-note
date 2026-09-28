# DNT Note — Hướng dẫn build & triển khai

> Cập nhật: 2026-09-27 · Version 0.1.0 · Mục tiêu: Windows 10/11, installer NSIS
> Liên quan: [system-architecture](./system-architecture.md) · [codebase-summary](./codebase-summary.md) · [project-roadmap](./project-roadmap.md)

## 1. Yêu cầu môi trường

| Thành phần | Yêu cầu | Ghi chú |
|---|---|---|
| OS | Windows 10/11 | Mục tiêu duy nhất hiện tại |
| Node.js | 20+ | Cho Vite 7 + Tauri CLI |
| Rust | 1.77+ toolchain **MSVC** | `rustup default stable-x86_64-pc-windows-msvc` |
| WebView2 | Có sẵn trên Win 10/11 | Runtime để render UI |
| Build tools | Visual Studio Build Tools (C++) | Đi kèm yêu cầu MSVC của Tauri 2 |

## 2. Chạy dev

```bash
npm install
npm run tauri dev        # app desktop đầy đủ (mở cửa sổ Tauri)
npm run dev              # browser-only: Vite ở http://localhost:5173
```

- `npm run dev` chạy app trong browser với shim: Tauri API qua `isTauri` guard + dynamic import;
  providers fallback localStorage, không có file IO thật — dùng cho UI dev/test nhanh.
- `npm run tauri dev` dùng dev server `localhost:5173` (strictPort trong `vite.config.ts`).

## 3. Build release

```bash
npm run tauri build      # type-check (tsc --noEmit) + vite build + build Rust + đóng gói
```

- Kết quả: **installer NSIS** tại `src-tauri/target/release/bundle/nsis/`
  (`dist/` phía frontend là bundle Vite được Tauri nhúng — cấu hình `frontendDist: ../dist`).
- App chạy standalone không cần Node; dữ liệu tự tạo tại
  `%APPDATA%\com.dungnt.dntnote\`.

### Build riêng MCP server

```bash
cd src-tauri
cargo build -p mcp-server            # debug
cargo build -p mcp-server --release  # release
```

- Binary: `src-tauri/target/release/dnt-note-mcp.exe` (binary nhỏ — chỉ dep notes-core + serde_json).
- Copy file này tới nơi AI client chạy được (xem §6).

## 4. Sinh icon

```bash
node scripts/make-icon.mjs   # sinh bộ icon từ src-tauri/icons/dnt-note.svg qua `tauri icon`
```

Chạy lại sau khi sửa `dnt-note.svg` (source monogram D/N). `build.rs` đã khai báo
`rerun-if-changed` cho icon.

## 5. Kiểm thử trước phát hành

```bash
npm test                      # unit tests TS (Vitest)
cd src-tauri && cargo test --workspace   # unit tests Rust
```

**Smoke checklist thủ công (chưa verified — cần người chạy):**

- [ ] Chat với LLM thật (cần API key hoặc Ollama local)
- [ ] Vision: paste/kéo-thả ảnh vào composer → model trả lời theo ảnh
- [ ] `Ctrl+Shift+N` toàn hệ thống khi app chạy nền (tray)
- [ ] Deep-link: mở `dntnote://note/<id>` từ trình duyệt (app đang chạy)
- [ ] Sync OneDrive thật: chọn thư mục OneDrive, sửa file từ máy khác
- [ ] Quick capture Enter lưu note tag `quick`; Esc ẩn
- [ ] PDF export: nút ⬇ trong editor → cửa sổ in → Save as PDF
- [ ] MCP: pipe qua stdin/stdout `initialize` → `tools/list` → `tools/call`

Đã verified tại mốc README hiện tại: 168 TS + 52 Rust tests pass; `npm run build` sạch lỗi;
installer NSIS build thành công; app chạy thật (tray, quick capture, watcher, demo seed);
MCP pipe thật đọc đúng 4 notes.

## 6. Cấu hình sau cài đặt

### 6.1 AI provider

1. **Cài đặt → Providers**: chọn preset **Ollama** (local, seed sẵn lần đầu) / OpenAI /
   OpenRouter / Groq / vLLM; điền Base URL + API key (masked).
2. Bấm **Kiểm tra kết nối** (gọi `GET /models` qua Tauri HTTP).
3. **Chọn model…** → tick models (fuzzy search, hoặc gõ tay thêm model ngoài danh sách) → Lưu.
4. Đổi model nhanh ở dropdown header chat (nhóm theo provider).

Lưu ý: cần Ollama chạy với `OLLAMA_ORIGINS=*` hoặc tương đương nếu lỗi kết nối từ app —
**cần xác minh** (app dùng plugin-http nên không dính CORS trình duyệt, nhưng Ollama có thể
lọc origin riêng).

### 6.2 MCP client (ZCode / Claude Desktop…)

Build trước: `cd src-tauri && cargo build -p mcp-server`. Thêm vào config client:

```json
{
  "mcpServers": {
    "dnt-note": {
      "command": "C:\\path\\to\\dnt-note-mcp.exe",
      "args": ["C:\\Users\\<you>\\AppData\\Roaming\\com.dungnt.dntnote\\notes"]
    }
  }
}
```

- Bỏ `args` để dùng thư mục mặc định (`%APPDATA%\com.dungnt.dntnote\notes`).
- Tool `open_note` trả URL `dntnote://note/<id>` — mở URL sẽ focus note trong app (app phải đang chạy).

### 6.3 Sync folder

**Cài đặt → Dữ liệu** → chọn thư mục sync (vd thư mục OneDrive) → mirror 2 chiều chạy nền
(watcher 500ms), xung đột newer-wins theo frontmatter `updated`. Tắt bất kỳ lúc nào.

## 7. Vị trí dữ liệu + backup/restore

```
%APPDATA%\com.dungnt.dntnote\
├── notes\<uuid>.md            # ghi chú (frontmatter + markdown)
├── notes\.trash\<uuid>.md     # note đã xóa mềm
├── attachments\<uuid>-<name>  # mọi attachment (note + chat)
├── chats\<id>.json            # lịch sử chat AI
├── settings.json              # {onboarded, syncFolder}
└── providers.json             # cấu hình LLM (API key nằm ở đây — plaintext)
```

- **Backup:** sao chép nguyên thư mục trên (app nên đóng khi backup để tránh ghi giữa chừng;
  bản thân từng file `.md` luôn atomic nên ít rủi ro hỏng).
- **Restore:** dán đè thư mục về vị trí cũ trước khi mở app.
- **Chuyển máy:** copy thư mục + cài lại app; nếu dùng sync folder thì thư mục đó cũng là
  bản sao đầy đủ notes + attachments.

## 8. Khắc phục sự cố thường gặp

| Hiện tượng | Nguyên nhân / xử lý |
|---|---|
| Lỗi kết nối LLM nhưng không phải CORS | App gọi LLM qua Tauri plugin-http (không CORS trình duyệt); kiểm tra Base URL (client tự thêm `/v1`), API key, và bấm "Kiểm tra kết nối". Với Ollama: đảm bảo service đang chạy |
| Note hiện `⚠ <tên file>` read-only | Frontmatter hỏng (thiếu `id`…). App cố tình chặn ghi để không mất dữ liệu — sửa frontmatter bằng editor ngoài (đúng 6 trường `id, title, tags, pinned, created, updated`) rồi app tự reload qua watcher |
| File đính kèm biến mất | Dọn mồ côi tự động lúc khởi động: xóa file trong `attachments\` không được tham chiếu bởi note/chat nào **quá 7 ngày** (grace). File chat được bảo vệ; file mtime lạ được giữ |
| Sửa file ngoài app không cập nhật | Watcher debounce 300ms (~1s tổng); kiểm tra file nằm trong `notes\` của `%APPDATA%\com.dungnt.dntnote` và đuôi `.md` |
| Deep-link không hoạt động | Scheme `dntnote` đăng ký khi cài installer; app phải đang chạy (single-instance sẽ forward); kiểm tra `HKCU\Software\Classes\dntnote` — cần xác minh |
| Quick capture không mở | App phải chạy nền (tray); kiểm tra global shortcut `Ctrl+Shift+N` không bị app khác chiếm |
| Model list trống | Bấm "Kiểm tra kết nối" trước; thêm model tay trong ModelPickerDialog nếu provider không trả `GET /models` |
| MCP client không thấy tools | Đúng đường dẫn binary; `args` chỉ_notes_dir nếu dùng vault khác; server nói JSON-RPC theo **dòng** stdio, protocol 2024-11-05 |

Chi tiết kiến trúc liên quan vận hành: [system-architecture](./system-architecture.md).
