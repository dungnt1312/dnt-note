---
name: flashcards
description: "Tạo bộ flashcard hỏi–đáp từ một ghi chú để ôn tập, lưu thành ghi chú mới."
enabled: true
---
# Flashcards

Dùng khi người dùng muốn "tạo flashcard", "câu hỏi ôn tập" từ một ghi chú.

## Các bước
1. Xác định ghi chú nguồn: ghi chú đang mở, hoặc dùng `search_notes` rồi hỏi lại nếu có nhiều kết quả.
2. Đọc nội dung bằng `read_note`.
3. Tạo 5–15 thẻ (tuỳ độ dài), mỗi thẻ kiểm tra một ý duy nhất; câu hỏi ngắn, đáp án chính xác theo nội dung gốc.
4. Tạo ghi chú mới bằng `create_note`, tiêu đề `Flashcards: <tiêu đề nguồn>`:

```markdown
# Flashcards: <tiêu đề nguồn>

Nguồn: [[<tiêu đề nguồn>]]

**H:** <câu hỏi>
**Đ:** <đáp án>

---
```

5. Gắn tag `flashcards` bằng `set_tags`.
6. Báo lại số thẻ đã tạo.

## Lưu ý
- Chỉ dùng kiến thức có trong ghi chú, không thêm thông tin bên ngoài.
- Ưu tiên khái niệm, định nghĩa, số liệu và quan hệ nhân quả.
