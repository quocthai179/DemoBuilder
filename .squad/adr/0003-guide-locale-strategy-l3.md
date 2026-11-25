# ADR-0003: Locale L3 — ép `en-US` chỉ trong context chụp guide, phát hiện lệch, fallback trích nguyên văn
Status: Proposed
Date: 2026-11-25

## Context
- Guide chỉ bằng tiếng Anh (FR-16). Demo thường chạy `vi-VN`: `record.mjs:187` dùng `locale: spec.locale || spec.language`.
- Q1 → L3: `guide.yaml.locale` mặc định `en-US` và chỉ áp dụng khi chụp guide. Nếu app không đổi sang tiếng Anh thì trích nguyên văn nhãn và cảnh báo ở checkpoint.
- Session login: `setup:` chạy trong một context riêng với cùng `ctxOpts`. Nếu có `auth.save` thì storageState được ghi ra file (`record.mjs:190-201`) và các lần quay video sau dùng lại file đó.
- `examples/sample-app/index.html` có `<html lang="vi">` và nhãn tiếng Việt cố định.

## Options considered
| Option | Pros | Cons |
|---|---|---|
| A. Đổi `spec.locale` tạm thời / dùng chung context với video | Ít code | Rủi ro thay đổi video; trái FR-3 |
| B. Context riêng cho guide với `locale = guide.yaml.locale`; setup chạy lại dưới locale đó; **không ghi `auth.save`**; tuỳ chọn `freshSession` | Cô lập hoàn toàn khỏi video; session `en-US` không rò sang take sau | Setup chạy lại mỗi lần capture (vài giây) |
| C. Thêm "extra setup" riêng cho guide để đổi ngôn ngữ trong cài đặt app | Hỗ trợ app chỉ đổi ngôn ngữ qua UI | Mở rộng phạm vi; dễ để lại trạng thái trên staging |

## Decision
Chọn **B**. Không làm C trong MVP (để mở rộng sau).
- `ctxOpts.locale = cfg.locale` cho cả setup context lẫn capture context của guide. Mọi trường khác giữ như `record()`.
- Gọi `prepareSession(..., { save: false, fresh: cfg.capture.freshSession })`.
- **Phát hiện lệch** theo từng bước:
  - `html[lang]` có primary subtag khác với `cfg.locale`; **hoặc**
  - nhãn DOM của phần tử đích có chữ cái ngoài ASCII (`/(?![\x00-\x7F])\p{L}/u`).
  Khi đó gắn `steps[].flags.localeMismatch`, tổng hợp `steps.json.locale.mismatchSteps` và cảnh báo `LOCALE_MISMATCH`. Toolkit cũng ghi `navigator.language` để kiểm chứng locale đã áp dụng.
- **Agent:** bước có mismatch thì trích nhãn **nguyên văn** in đậm, có thể kèm gloss tiếng Anh trong ngoặc (`Click **Lưu** ("Save").`). Agent không bao giờ thay nhãn bằng bản dịch (BR-2). Cảnh báo được nêu ở checkpoint.

## Consequences
- Video không bị ảnh hưởng. Session do guide tạo không ghi đè file `auth.save`.
- Heuristic ASCII có false positive với nhãn tiếng Anh có dấu (vd "Café"). Hậu quả chỉ là một cảnh báo và câu trích nguyên văn, vẫn đúng với ảnh.
- App lưu ngôn ngữ trong session: bật `capture.freshSession`. App chỉ đổi ngôn ngữ qua cài đặt người dùng thì chấp nhận L2 (theo quyết định Q1).
- Ảnh có thể khác video về định dạng số/ngày (Intl theo `en-US`). Điều này là mong muốn cho guide tiếng Anh.
