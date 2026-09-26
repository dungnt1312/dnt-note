# AI Assistant (sắp có)

DNT Note sẽ có trợ lý AI dạng **agent** — không chỉ trò chuyện mà trực tiếp thao tác
được với các ghi chú của bạn thông qua 10 công cụ:

1. `list_notes` — liệt kê ghi chú
2. `search_notes` — tìm kiếm
3. `read_note` — đọc nội dung
4. `create_note` — tạo ghi chú mới
5. `update_note` — sửa ghi chú
6. `delete_note` — xóa (luôn có bước xác nhận + hoàn tác)
7. `get_stats` — thống kê
8. `list_tags` — liệt kê tags
9. `set_tags` — gán tags
10. `get_recent_notes` — ghi chú cập nhật gần đây

Hỗ trợ mọi provider chuẩn **OpenAI-compatible**: OpenAI, Ollama (chạy local),
OpenRouter, Groq, vLLM — bạn cấu hình tên, baseURL, model và API key riêng từng provider.

Ngoài ra còn có **MCP server** cho phép các AI client bên ngoài (ZCode, Claude, ...)
đọc/ghi ghi chú của bạn một cách hai chiều, cập nhật real-time.

Tất cả chạy local-first: không server trung gian, dữ liệu không rời khỏi máy bạn
(trừ lời gọi API tới provider bạn tự cấu hình).
