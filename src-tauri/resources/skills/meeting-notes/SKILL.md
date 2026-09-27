---
name: meeting-notes
description: "Biến nội dung cuộc họp thô thành ghi chú có cấu trúc: người tham dự, quyết định, việc cần làm."
enabled: true
---
# Biên bản cuộc họp

Dùng khi người dùng dán nội dung họp thô hoặc yêu cầu "tóm tắt cuộc họp".

## Các bước
1. Nếu người dùng nhắc tới một ghi chú có sẵn, dùng `search_notes` rồi `read_note` để lấy nội dung.
2. Rút ra: chủ đề, ngày họp, người tham dự, các điểm thảo luận chính, quyết định, việc cần làm (ai – việc gì – hạn).
3. Tạo ghi chú mới bằng `create_note` (hoặc `update_note` nếu người dùng muốn ghi đè ghi chú gốc) theo mẫu:

```markdown
# Họp: <chủ đề> – <ngày>

**Người tham dự:** A, B, C

## Tóm tắt
- ...

## Quyết định
- ...

## Việc cần làm
- [ ] <việc> — @<người> (hạn: <ngày>)
```

4. Gắn tag `meeting` bằng `set_tags` (giữ các tag cũ nếu có).
5. Trả lời ngắn gọn: tiêu đề ghi chú đã tạo và số việc cần làm.

## Lưu ý
- Không bịa thông tin; mục nào không có thì ghi "Chưa rõ".
- Giữ nguyên ngôn ngữ của nội dung gốc.
