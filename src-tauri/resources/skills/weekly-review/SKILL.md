---
name: weekly-review
description: "Tổng hợp các ghi chú cập nhật trong 7 ngày qua thành một ghi chú review tuần."
enabled: true
---
# Review tuần

Dùng khi người dùng yêu cầu "review tuần", "tổng kết tuần" hoặc tương tự.

## Các bước
1. Gọi `get_recent_notes` (hoặc `list_notes`) và chỉ giữ các ghi chú có `updated` trong 7 ngày gần nhất.
2. Với mỗi ghi chú liên quan, dùng `read_note` để đọc nội dung (đọc lướt, không cần toàn bộ nếu quá dài).
3. Tạo ghi chú mới bằng `create_note` với tiêu đề `Review tuần <ngày bắt đầu> – <ngày kết thúc>`:

```markdown
# Review tuần <từ> – <đến>

## Đã làm được
- ... ([[Tiêu đề ghi chú]])

## Việc còn dang dở
- [ ] ...

## Ý tưởng / ghi nhận nổi bật
- ...

## Ưu tiên tuần tới
1. ...
```

4. Gắn tag `weekly-review` bằng `set_tags`.
5. Trả lời người dùng bằng 2–3 câu tóm tắt và tên ghi chú đã tạo.

## Lưu ý
- Lấy việc dang dở từ các checkbox `- [ ]` chưa hoàn thành trong ghi chú.
- Không liệt kê ghi chú trong thùng rác hoặc không có nội dung.
